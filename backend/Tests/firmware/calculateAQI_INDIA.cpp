// Verbatim copy of lines 530-558 of Vayu_004_18072026.ino (ESP32 firmware). Used ONLY as the test oracle: Tests/Run-ApiTests.ps1 parses the
// map() breakpoints and the status thresholds from this text, so the expected AQI values come from the firmware source itself.
// --------------------------- AQI (India CPCB style breakpoints) ---------------------------
int calculateAQI_INDIA(int pm25_val, int pm10_val) {
  int aqiPM25, aqiPM10;

  if (pm25_val <= 30)       aqiPM25 = map(pm25_val, 0,   30,  0,   50);
  else if (pm25_val <= 60)  aqiPM25 = map(pm25_val, 31,  60,  51,  100);
  else if (pm25_val <= 90)  aqiPM25 = map(pm25_val, 61,  90,  101, 200);
  else if (pm25_val <= 120) aqiPM25 = map(pm25_val, 91,  120, 201, 300);
  else if (pm25_val <= 250) aqiPM25 = map(pm25_val, 121, 250, 301, 400);
  else                      aqiPM25 = map(pm25_val, 251, 500, 401, 500);

  if (pm10_val <= 50)       aqiPM10 = map(pm10_val, 0,   50,  0,   50);
  else if (pm10_val <= 100) aqiPM10 = map(pm10_val, 51,  100, 51,  100);
  else if (pm10_val <= 250) aqiPM10 = map(pm10_val, 101, 250, 101, 200);
  else if (pm10_val <= 350) aqiPM10 = map(pm10_val, 251, 350, 201, 300);
  else if (pm10_val <= 430) aqiPM10 = map(pm10_val, 351, 430, 301, 400);
  else                      aqiPM10 = map(pm10_val, 431, 500, 401, 500);

  return max(aqiPM25, aqiPM10);
}

String getAQIStatus(int aqi) {
  if (aqi <= 50)   return "Good";
  else if (aqi <= 100) return "Satisfactory";
  else if (aqi <= 200) return "Moderate";
  else if (aqi <= 300) return "Poor";
  else if (aqi <= 400) return "Very Poor";
  else                 return "Severe";
}
