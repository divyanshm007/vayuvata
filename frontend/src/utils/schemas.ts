import { z } from 'zod';

// Mirrors backend/Validators/*.cs
export const passwordSchema = z
  .string()
  .min(10, 'At least 10 characters.')
  .max(100, 'At most 100 characters.')
  .regex(/[A-Z]/, 'Include an uppercase letter.')
  .regex(/[a-z]/, 'Include a lowercase letter.')
  .regex(/[0-9]/, 'Include a digit.');

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email.').max(256),
  password: z.string().min(1, 'Enter your password.').max(200),
  remember: z.boolean().optional(),
});

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, 'Enter your current password.').max(200), newPassword: passwordSchema, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match.' })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'The new password must be different from the current password.' });

const name = z.string().trim().min(1, 'Name is required.').max(150, 'At most 150 characters.');
const email = z.string().trim().min(1, 'Email is required.').max(256).email('Enter a valid email.');

export const mobileSchema = z.string().trim().min(1, 'Mobile number is required.')
  .refine((v) => /^\+?[0-9]{10,15}$/.test(v.replace(/[\s\-().]/g, '')), 'Enter a valid mobile number (10 to 15 digits).');

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(150),
  email,
  mobile: mobileSchema,
  requestedRole: z.enum(['Admin', 'User']),
  adminEmail: z.string().trim().max(256).optional(),
  deviceId: z.string().trim().max(64).regex(/^[A-Za-z0-9_:-]*$/, "Only letters, digits, '-', '_' and ':'.").optional(),
}).superRefine((v, ctx) => {
  if (v.requestedRole === 'User') {
    if (!v.adminEmail) ctx.addIssue({ code: 'custom', path: ['adminEmail'], message: 'Enter the email address of your Admin.' });
    else if (!z.string().email().safeParse(v.adminEmail).success) ctx.addIssue({ code: 'custom', path: ['adminEmail'], message: 'Enter a valid email.' });
  }
});

export const activateSchema = z.object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match.' });

export const createUserSchema = z.object({ name, email, password: passwordSchema });
export const updateUserSchema = z.object({ name, email });
export const resetPasswordSchema = z.object({ newPassword: passwordSchema });

export const createDeviceSchema = z.object({
  deviceId: z.string().trim().min(1, 'Device ID is required.').max(64).regex(/^[A-Za-z0-9_:-]+$/, "Only letters, digits, '-', '_' and ':'."),
  deviceName: z.string().trim().min(1, 'Name is required.').max(150),
  description: z.string().max(500, 'At most 500 characters.').optional(),
});
export const updateDeviceSchema = z.object({
  deviceName: z.string().trim().min(1, 'Name is required.').max(150),
  description: z.string().max(500, 'At most 500 characters.').optional(),
});
