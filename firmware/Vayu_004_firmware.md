# Vayu_004 ESP32 firmware (latest)

Air-quality monitor firmware. Posts one reading per minute to `POST https://72.61.170.214:5443/api/v1/sensor-data` with the `X-Device-Key` header.

Notes
- The payload uses the API's camelCase names (`deviceId`, `recordedAt`, `no2Ppm`, `outerTemperature`, ...).
- `outerTemperature` / `outerHumidity` are sent **only when the RS485 read succeeded** (`rsValid`). If the RS485 sensor is not detected at boot, or a read fails, they are omitted and stored as NULL.
- Likewise `aqi/pm10/pm25` need a fresh PMS5003 frame, `coPpm` needs the 3 min warm-up, `tvocPpb` needs an ENS160 reading, and `humidity/temperature` need the AHT21.
- `API_KEY_HASH` below is a placeholder. Copy the real value from `dbo.Devices.ApiKeyHash` for `Vayu_004` (it is a device credential, so it is not stored in this repo).
- Libraries: Adafruit AHTX0, ScioSense ENS160, ArduinoJson (v6), WiFiManager (tzapu), ESP32 core (WiFi, HTTPClient, WiFiClientSecure).

```cpp
/*
 * ================================================================
 *  Vayu_002 — Air Quality Monitor
 *  - Raw sensor data (no PM calibration, no smoothing)
 *  - WiFiManager setup (hotspot "Vayu_Vata", password <setup-hotspot-password>)
 *  - HTTPS, no certificate pinning (device authenticated by ID + key)
 *  - API: POST https://72.61.170.214:5443/api/v1/sensor-data
 * ================================================================
 */

#include <Adafruit_AHTX0.h>
#include "ScioSense_ENS160.h"
#include <Wire.h>
#include <HardwareSerial.h>
#include <time.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// ================================================================
//  USER CONFIG
// ================================================================
// Copy both straight from the device's row in SQL (dbo.Devices: DeviceId, ApiKeyHash).
// The server checks this pair against that row; a post is accepted only if both match.
const char* DEVICE_ID    = "Vayu_004";
const char* API_KEY_HASH = "<ApiKeyHash from dbo.Devices for Vayu_004>";

// WiFi setup hotspot (WiFiManager)
const char* AP_NAME = "Vayu_Vata";
const char* AP_PASS = "<setup-hotspot-password>";


// ================================================================
//  FIXED CONFIG
// ================================================================
const char* SERVER_URL = "https://72.61.170.214:5443/api/v1/sensor-data";

// ================================================================
//  PINS
// ================================================================
#define NO2_PIN    34
#define SO2_PIN    32
#define CO_PIN     35
#define PMS_RX      5
// ESP32 has only 3 UARTs: UART0 = USB debug (Serial), UART1 = RS485, UART2 = PMS5003 + Nextion.
// UART2 RX listens to the PMS5003 (it streams on its own, needs no commands) and UART2 TX
// drives the Nextion display. WIRING: Nextion RX -> GPIO18; leave PMS5003 RX pin unconnected.
#define NEXTION_TX 18
#define RS485_RX   17
#define RS485_TX   16
#define RS485_DE   14
#define LED_PIN     2

// ================================================================
//  OBJECTS
// ================================================================
Adafruit_AHTX0   aht;
ScioSense_ENS160 ens160(ENS160_I2CADDR_1);
HardwareSerial   pmsSerial(2);          // RX = PMS5003, TX = Nextion (same 9600 baud)
HardwareSerial   rs485(1);

// CO sensor — inline ADC read (ZE07CO-03 DAC: 0.4V=0ppm, 2.0V=500ppm)
auto readCO = []() -> float {
  float v = analogRead(CO_PIN) * (3.3f / 4095.0f);
  return (v < 0.4f) ? 0.0f : (v - 0.4f) * (500.0f / 1.6f);
};

// ================================================================
//  SENSOR VALUES (all raw)
// ================================================================
uint16_t pm1_0   = 0, pm2_5 = 0, pm10 = 0;
float    no2_ppm = 0, so2_ppm = 0, co_ppm = 0;
int      tvoc_ppb = 0;
float    rsTemp  = 0, rsHum = 0;       // RS485 outer sensor

// Validity flags — a reading that is not valid is omitted from the upload (stored as NULL, never 0)
bool pmsValid   = false;   // fresh PMS5003 frame within PMS_WARN
bool tvocValid  = false;   // ENS160 produced a reading
bool rsValid    = false;   // last RS485 read succeeded
bool ensPresent = false;

// ================================================================
//  RS485 AUTO-DETECT
// ================================================================
byte     reqBuf[8], resBuf[16];
byte     correctFunc = 0;
uint16_t correctAddr = 0;
bool     rs485Ready  = false;

// ================================================================
//  CO WARMUP
// ================================================================
const unsigned long CO_WARMUP  = 180000UL; // 3 minutes
const int           CO_SAMPLES = 50;
float        zeroOffset = 0;
bool         calibrated = false;
unsigned long startTime = 0;

// ================================================================
//  PMS WATCHDOG
// ================================================================
unsigned long lastPMSValid = 0;
const unsigned long PMS_WARN = 30000UL;
const unsigned long PMS_FAIL = 120000UL;

// ================================================================
//  WiFi WATCHDOG
// ================================================================
unsigned long lastWiFiCheck     = 0;
unsigned long wifiLostAt        = 0;
const unsigned long WIFI_LIMIT  = 120000UL;

// ================================================================
//  TIMESTAMPS
// ================================================================
String currentDate   = "";
String currentTimeS  = "";
String currentTsUTC  = "";   // ISO-8601 UTC for API  e.g. 2026-10-11T08:30:00Z
String currentTsIST  = "";   // IST for display        e.g. 2026-10-11 14:00:00
unsigned long lastNTPRefresh = 0;

// ================================================================
//  NTP — IST display + UTC for API
// ================================================================
bool refreshTime() {
  time_t now = time(nullptr);
  if (now <= 1700000000UL) return false;

  struct tm local, utc;
  localtime_r(&now, &local);  // IST (configTime offset applied)
  gmtime_r   (&now, &utc);    // UTC

  char d[11], t[9], apiTs[21], dispTs[20];
  strftime(d,      sizeof(d),      "%Y-%m-%d",           &local);
  strftime(t,      sizeof(t),      "%H:%M:%S",           &local);
  strftime(apiTs,  sizeof(apiTs),  "%Y-%m-%dT%H:%M:%SZ", &utc);   // API
  strftime(dispTs, sizeof(dispTs), "%Y-%m-%d %H:%M:%S",  &local); // display

  currentDate  = d;
  currentTimeS = t;
  currentTsUTC = apiTs;
  currentTsIST = dispTs;
  return true;
}

// ================================================================
//  AQI — CPCB India
// ================================================================
int calcAQI(int p25, int p10) {
  int a25, a10;

  if      (p25 <=  30) a25 = map(p25,   0,  30,   0,  50);
  else if (p25 <=  60) a25 = map(p25,  31,  60,  51, 100);
  else if (p25 <=  90) a25 = map(p25,  61,  90, 101, 200);
  else if (p25 <= 120) a25 = map(p25,  91, 120, 201, 300);
  else if (p25 <= 250) a25 = map(p25, 121, 250, 301, 400);
  else                 a25 = map(p25, 251, 500, 401, 500);

  if      (p10 <=  50) a10 = map(p10,   0,  50,   0,  50);
  else if (p10 <= 100) a10 = map(p10,  51, 100,  51, 100);
  else if (p10 <= 250) a10 = map(p10, 101, 250, 101, 200);
  else if (p10 <= 350) a10 = map(p10, 251, 350, 201, 300);
  else if (p10 <= 430) a10 = map(p10, 351, 430, 301, 400);
  else                 a10 = map(p10, 431, 500, 401, 500);

  return max(a25, a10);
}

const char* aqiLabel(int aqi) {
  if (aqi <=  50) return "Good";
  if (aqi <= 100) return "Satisfactory";
  if (aqi <= 200) return "Moderate";
  if (aqi <= 300) return "Poor";
  if (aqi <= 400) return "Very Poor";
  return "Severe";
}

// ================================================================
//  NEXTION HELPER
// ================================================================
void nx(const String& cmd) {
  pmsSerial.print(cmd);
  pmsSerial.write(0xFF);
  pmsSerial.write(0xFF);
  pmsSerial.write(0xFF);
}

// ================================================================
//  WiFi WATCHDOG
// ================================================================
void checkWiFi() {
  if (millis() - lastWiFiCheck < 5000) return;
  lastWiFiCheck = millis();

  if (WiFi.status() == WL_CONNECTED) {
    digitalWrite(LED_PIN, HIGH);
    wifiLostAt = 0;
    return;
  }

  digitalWrite(LED_PIN, LOW);
  if (!wifiLostAt) wifiLostAt = millis();
  WiFi.reconnect();

  if (millis() - wifiLostAt > WIFI_LIMIT) {
    Serial.println("[WiFi] Timeout — restarting ESP");
    delay(1000);
    ESP.restart();
  }
}

// ================================================================
//  PMS5003 — raw CF=1 values, no calibration
// ================================================================
bool readPMS5003() {
  const int FL = 32;
  uint8_t f[FL];
  if (pmsSerial.available() < FL) return false;

  while (pmsSerial.available() >= FL) {
    if (pmsSerial.read() != 0x42) continue;
    if (pmsSerial.peek() != 0x4D) continue;
    f[0] = 0x42;
    if (pmsSerial.readBytes(f + 1, FL - 1) != FL - 1) return false;

    uint16_t sum = 0;
    for (int i = 0; i < FL - 2; i++) sum += f[i];
    if (sum != ((uint16_t)(f[FL-2] << 8) | f[FL-1])) {
      Serial.println("[PMS] CRC fail");
      continue;
    }

    pm1_0 = (f[4] << 8) | f[5];   // CF=1 raw
    pm2_5 = (f[6] << 8) | f[7];
    pm10  = (f[8] << 8) | f[9];
    lastPMSValid = millis();
    pmsValid = true;
    return true;
  }
  return false;
}

void pmsWatchdog() {
  if (!lastPMSValid) { lastPMSValid = millis(); return; }
  unsigned long since = millis() - lastPMSValid;

  if (since > PMS_FAIL) {
    Serial.println("[PMS] Dead 120s — restarting ESP");
    delay(200);
    ESP.restart();
  } else if (since > PMS_WARN) {
    Serial.println("[PMS] No frames 30s — reinit UART");
    while (pmsSerial.available()) pmsSerial.read();
    pmsSerial.end();
    delay(200);
    pmsSerial.begin(9600, SERIAL_8N1, PMS_RX, NEXTION_TX);
  }
}

// ================================================================
//  RS485 — Modbus CRC
// ================================================================
uint16_t crc16(byte* buf, int len) {
  uint16_t crc = 0xFFFF;
  for (int i = 0; i < len; i++) {
    crc ^= buf[i];
    for (int b = 0; b < 8; b++)
      crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : (crc >> 1);
  }
  return crc;
}

bool probeSensor(byte func, uint16_t addr) {
  reqBuf[0] = 0x01; reqBuf[1] = func;
  reqBuf[2] = addr >> 8; reqBuf[3] = addr & 0xFF;
  reqBuf[4] = 0x00; reqBuf[5] = 0x02;
  uint16_t c = crc16(reqBuf, 6);
  reqBuf[6] = c & 0xFF; reqBuf[7] = c >> 8;

  digitalWrite(RS485_DE, HIGH); delay(1);
  rs485.write(reqBuf, 8); rs485.flush(); delay(2);
  digitalWrite(RS485_DE, LOW);

  unsigned long t = millis(); int n = 0;
  while (millis() - t < 150 && n < 9)
    if (rs485.available()) resBuf[n++] = rs485.read();

  return (n == 9 && resBuf[0] == 0x01 && resBuf[1] == func);
}

// ================================================================
//  SETUP
// ================================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n\n=== Vayu_002 Starting ===");

  // Peripherals
  pmsSerial.begin(9600, SERIAL_8N1, PMS_RX, NEXTION_TX);   // PMS5003 in, Nextion out
  pinMode(RS485_DE, OUTPUT); digitalWrite(RS485_DE, LOW);
  rs485.begin(9600, SERIAL_8N1, RS485_RX, RS485_TX);
  pinMode(LED_PIN, OUTPUT); digitalWrite(LED_PIN, LOW);

  // I2C
  Wire.begin(21, 22);
  if (!aht.begin()) { Serial.println("[AHT21] NOT FOUND — HALT"); while (1); }
  Serial.println("[AHT21] OK");

  if (ens160.begin()) { ens160.setMode(ENS160_OPMODE_STD); ensPresent = true; Serial.println("[ENS160] OK"); }
  else                  Serial.println("[ENS160] Not found");

  // ADC
  analogReadResolution(12);
  analogSetPinAttenuation(NO2_PIN, ADC_11db);
  analogSetPinAttenuation(SO2_PIN, ADC_11db);
  analogSetPinAttenuation(CO_PIN,  ADC_11db);
  startTime = millis();

  // RS485 auto-detect
  byte funcs[]     = {0x03, 0x04};
  uint16_t addrs[] = {0x0000, 0x0001, 0x0002};
  for (int f = 0; f < 2 && !rs485Ready; f++)
    for (int a = 0; a < 3 && !rs485Ready; a++)
      if (probeSensor(funcs[f], addrs[a])) {
        correctFunc = funcs[f];
        correctAddr = addrs[a];
        rs485Ready  = true;
        Serial.printf("[RS485] Found — func=0x%02X  reg=0x%04X\n", correctFunc, correctAddr);
      }
  if (!rs485Ready) Serial.println("[RS485] Not detected");

  // --- WiFiManager: uses saved WiFi, else opens the setup hotspot ---
  WiFiManager wm;
  wm.setConnectTimeout(20);          // give up on a saved network after 20 s
  wm.setConfigPortalTimeout(180);    // keep the hotspot open for 3 min
  Serial.println("[WiFi] Connecting (WiFiManager)...");
  if (!wm.autoConnect(AP_NAME, AP_PASS)) {
    Serial.println("[WiFi] FAILED — restarting");
    ESP.restart();
  }
  Serial.printf("[Config] Device ID: %s\n", DEVICE_ID);
  Serial.printf("\n[WiFi] Connected — IP: %s\n", WiFi.localIP().toString().c_str());
  WiFi.setAutoReconnect(true);
  WiFi.persistent(true);
  digitalWrite(LED_PIN, HIGH);

  // NTP — IST = UTC + 5:30 = 19800 s
  configTime(19800, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("[NTP] Syncing");
  for (int i = 0; i < 40 && time(nullptr) <= 1700000000UL; i++) {
    delay(500); Serial.print(".");
  }
  if (refreshTime()) Serial.printf("\n[NTP] OK — IST: %s  UTC: %s\n", currentTsIST.c_str(), currentTsUTC.c_str());
  else               Serial.println("\n[NTP] Sync failed");

  Serial.println("=== Boot complete ===\n");
}

// ================================================================
//  LOOP
// ================================================================
void loop() {
  static unsigned long lastDisplay = 0;
  static unsigned long lastPMSRead = 0;
  static unsigned long lastGasRead = 0;
  static unsigned long lastRS485   = 0;
  static unsigned long lastCORead  = 0;
  static unsigned long lastUpload  = 0;

  unsigned long now = millis();

  // -- WiFi watchdog --
  checkWiFi();

  // -- NTP refresh every 30 s --
  if (now - lastNTPRefresh > 30000 || currentTsUTC == "")
    if (WiFi.status() == WL_CONNECTED && refreshTime())
      lastNTPRefresh = now;

  // -- AHT21 temperature / humidity --
  sensors_event_t hEv, tEv;
  bool  ahtOk = aht.getEvent(&hEv, &tEv) && !isnan(tEv.temperature) && !isnan(hEv.relative_humidity);
  float temp  = ahtOk ? tEv.temperature       : 0.0f;
  float hum   = ahtOk ? hEv.relative_humidity : 0.0f;

  // -- PMS5003 (every 1 s) --
  if (now - lastPMSRead >= 1000) {
    lastPMSRead = now;
    readPMS5003();
  }
  // millis() (not the cached `now`): a frame read just above makes lastPMSValid > now,
  // and the unsigned subtraction would wrap and wrongly mark PM invalid.
  if (millis() - lastPMSValid > PMS_WARN) { pmsValid = false; pmsWatchdog(); }

  // -- NO2 & SO2 (every 1 s) --
  if (now - lastGasRead >= 1000) {
    lastGasRead = now;

    int rawNO2 = analogRead(NO2_PIN);
    no2_ppm = (rawNO2 < 50) ? 0.0f : rawNO2 * (3.3f / 4095.0f);

    float vSO2 = analogRead(SO2_PIN) * (3.3f / 4095.0f);
    so2_ppm = (vSO2 < 0.4f) ? 0.0f : max(0.0f, (vSO2 - 0.4f) * (20.0f / 1.6f));
  }

  // -- RS485 outer sensor (every 1 s) --
  if (rs485Ready && now - lastRS485 >= 1000) {
    lastRS485 = now;

    reqBuf[0] = 0x01; reqBuf[1] = correctFunc;
    reqBuf[2] = correctAddr >> 8; reqBuf[3] = correctAddr & 0xFF;
    reqBuf[4] = 0x00; reqBuf[5] = 0x02;
    uint16_t c = crc16(reqBuf, 6);
    reqBuf[6] = c & 0xFF; reqBuf[7] = c >> 8;

    digitalWrite(RS485_DE, HIGH); delay(1);
    rs485.write(reqBuf, 8); rs485.flush(); delay(2);
    digitalWrite(RS485_DE, LOW);

    unsigned long t = millis(); int n = 0;
    while (millis() - t < 150 && n < 9)
      if (rs485.available()) resBuf[n++] = rs485.read();

    if (n == 9 && resBuf[0] == 0x01 && resBuf[1] == correctFunc) {
      rsTemp = ((resBuf[3] << 8) | resBuf[4]) / 10.0f;
      rsHum  = ((resBuf[5] << 8) | resBuf[6]) / 10.0f;
      rsValid = true;
    } else {
      rsTemp = 0; rsHum = 0; rsValid = false;
      Serial.println("[RS485] Read error");
    }
  }

  // -- CO (every 3 s — 50 samples x 10 ms = 500 ms blocking) --
  if (now - lastCORead >= 3000) {
    lastCORead = now;

    if (now - startTime >= CO_WARMUP) {
      if (!calibrated) {
        float sum = 0;
        for (int i = 0; i < CO_SAMPLES; i++) { sum += readCO(); delay(10); }
        zeroOffset = sum / CO_SAMPLES;
        calibrated = true;
        Serial.printf("[CO] Calibrated  zero=%.3f ppm\n", zeroOffset);
      }
      float sum = 0;
      for (int i = 0; i < CO_SAMPLES; i++) { sum += readCO(); delay(10); }
      co_ppm = max(0.0f, (sum / CO_SAMPLES) - zeroOffset);
    } else {
      co_ppm = 0.0f;
    }
  }

  // -- ENS160 TVOC --
  if (ensPresent) {
    if (ahtOk) ens160.set_envdata(temp, hum);
    if (ens160.available()) {
      ens160.measure(true);
      if (ens160.getAQI() > 0) { tvoc_ppb = ens160.getTVOC(); tvocValid = true; }
    }
  }

  // -- Serial display + Nextion (every 1 s) --
  if (now - lastDisplay >= 1000) {
    lastDisplay = now;
    int  aqi      = calcAQI(pm2_5, pm10);
    bool inWarmup = (now - startTime < CO_WARMUP);
    unsigned long warmLeft = inWarmup ? (CO_WARMUP - (now - startTime)) / 1000 : 0;

    // ---- Full serial output ----
    Serial.println("============ Vayu_002 RAW DATA ============");
    Serial.printf("  Timestamp (IST) : %s\n",       currentTsIST.c_str());
    Serial.printf("  Timestamp (UTC) : %s\n",       currentTsUTC.c_str());
    Serial.println("  --- Particulates ---");
    Serial.printf("  PM1.0           : %u ug/m3\n", pm1_0);
    Serial.printf("  PM2.5           : %u ug/m3\n", pm2_5);
    Serial.printf("  PM10            : %u ug/m3\n", pm10);
    Serial.println("  --- Gas ---");
    Serial.printf("  NO2             : %.3f ppm\n", no2_ppm);
    Serial.printf("  SO2             : %.3f ppm\n", so2_ppm);
    if (inWarmup)
      Serial.printf("  CO              : Warmup (%lu s left)\n", warmLeft);
    else
      Serial.printf("  CO              : %.3f ppm\n", co_ppm);
    Serial.printf("  TVOC            : %d ppb\n",   tvoc_ppb);
    Serial.println("  --- Environment ---");
    Serial.printf("  Temp  (AHT21)   : %.2f C\n",  temp);
    Serial.printf("  Hum   (AHT21)   : %.2f %%\n", hum);
    Serial.printf("  Temp  (RS485)   : %.1f C\n",  rsTemp);
    Serial.printf("  Hum   (RS485)   : %.1f %%\n", rsHum);
    Serial.println("  --- AQI ---");
    Serial.printf("  AQI             : %d  [%s]\n", aqi, aqiLabel(aqi));
    Serial.println("===========================================");

    // ---- Nextion update ----
    nx("t0.txt=\"" + String(rsTemp, 1)      + "\"");
    nx("t1.txt=\"" + String(rsHum,  1)      + "\"");
    nx("t2.txt=\"" + String(pm2_5)          + "\"");
    nx("t3.txt=\"" + String(pm10)           + "\"");
    nx("t5.txt=\"" + String(co_ppm,  2)     + "\"");
    nx("t6.txt=\"" + String(aqi)            + "\"");
    nx("t7.txt=\"" + String(tvoc_ppb)       + "\"");
    nx("t8.txt=\"" + String(no2_ppm, 2)     + "\"");
    nx("t9.txt=\"" + String(so2_ppm, 2)     + "\"");
    nx("t4.txt=\"" + String(aqiLabel(aqi))  + "\"");

    int pbar = (int)map(aqi, 0, 500, 0, 100);
    nx("j0.val=" + String(pbar));
    String col = "j0.pco=";
    if      (aqi <=  50) col += "2016";
    else if (aqi <= 100) col += "34784";
    else if (aqi <= 200) col += "65504";
    else if (aqi <= 300) col += "64640";
    else if (aqi <= 400) col += "63488";
    else                 col += "34880";
    nx(col);
  }

  // -- HTTPS upload (every 60 s) --
  if (now - lastUpload >= 60000UL) {
    lastUpload = now;

    if (WiFi.status() != WL_CONNECTED) { Serial.println("[Upload] Skipped — WiFi down"); return; }
    if (currentTsUTC  == "")            { Serial.println("[Upload] Skipped — no NTP time"); return; }

    int aqi = calcAQI(pm2_5, pm10);

    StaticJsonDocument<512> doc;
    doc["deviceId"]         = DEVICE_ID;
    // Time fields are IST (from NTP) and are stored by the server exactly as sent.
    doc["recordedAt"]       = currentDate + "T" + currentTimeS;   // e.g. 2026-10-11T15:15:56
    doc["dataDate"]         = currentDate;                        // e.g. 2026-10-11
    doc["dataTime"]         = currentTimeS;                       // e.g. 15:15:56
    // Only valid readings are sent; omitted fields are stored as NULL by the API (never 0).
    if (pmsValid) {
      doc["aqi"]       = aqi;
      doc["aqiStatus"] = aqiLabel(aqi);
      doc["pm10"]      = pm10;
      doc["pm25"]      = pm2_5;
    }
    doc["no2Ppm"]           = no2_ppm;
    doc["so2Ppm"]           = so2_ppm;
    if (calibrated)  doc["coPpm"]            = co_ppm;     // not before warmup + zero calibration
    if (tvocValid)   doc["tvocPpb"]          = tvoc_ppb;
    if (ahtOk) {
      doc["humidity"]       = hum;
      doc["temperature"]    = temp;
    }
    if (rsValid) {
      doc["outerTemperature"] = rsTemp;
      doc["outerHumidity"]    = rsHum;
    }

    String payload;
    serializeJson(doc, payload);
    Serial.println("[Upload] Payload:");
    Serial.println(payload);

    WiFiClientSecure client;
    client.setInsecure(); // no certificate check: the server authenticates the device by ID + key (checked in SQL)

    HTTPClient http;
    if (!http.begin(client, SERVER_URL)) {
      Serial.println("[Upload] http.begin() failed");
      return;
    }
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Key", API_KEY_HASH);
    http.setTimeout(10000);

    int code = http.POST(payload);
    if (code > 0)
      Serial.printf("[Upload] HTTP %d — %s\n", code, http.getString().c_str());
    else
      Serial.printf("[Upload] Failed — %s\n", http.errorToString(code).c_str());

    http.end();
  }
}
```
