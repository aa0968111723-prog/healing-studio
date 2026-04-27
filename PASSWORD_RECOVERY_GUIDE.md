# Password Recovery & Account Management System

## Overview

This document describes the password recovery and account management system that has been implemented for Healing Studio. The system provides secure password reset functionality, account profile management, and password change capabilities.

## Features

### 1. Password Reset Flow
- **Forgot Password**: Users can request a password reset link via email
- **Token-based Reset**: Secure, time-limited tokens (1 hour expiration)
- **Email Notifications**: Automatic email notifications for password reset requests and completions
- **Rate Limiting**: Protection against brute force attacks (3 requests per email per hour)

### 2. Account Management
- **Profile Management**: Users can update their display name
- **Password Change**: Users can change their password with current password verification
- **Security Requirements**: Strong password enforcement (uppercase, lowercase, numbers, symbols)

### 3. Security Features
- **Token Hashing**: All tokens are hashed before storage using SHA-256
- **Rate Limiting**: Built-in protection against abuse
- **Email Enumeration Prevention**: Always returns success to prevent email harvesting
- **Strong Password Requirements**: Enforced on both frontend and backend

## Architecture

### Backend Components

#### 1. Database Schema
```sql
-- Password Reset Tokens
CREATE TABLE password_reset_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  tokenHash VARCHAR(128) NOT NULL UNIQUE,
  expiresAt TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT false,
  createdAt TIMESTAMP DEFAULT NOW()
);

-- Email Verification Tokens (future use)
CREATE TABLE email_verification_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  newEmail VARCHAR(320) NOT NULL,
  tokenHash VARCHAR(128) NOT NULL UNIQUE,
  expiresAt TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT false,
  createdAt TIMESTAMP DEFAULT NOW()
);
```

#### 2. Services

**EmailService** (`server/services/auth/emailService.ts`)
- Sends transactional emails for password reset, password changes, and email verification
- Supports both HTML and plain text email formats
- Gracefully handles missing SMTP configuration (logs emails in development)
- Methods:
  - `sendPasswordReset(email, resetToken)`: Send password reset email
  - `sendPasswordChanged(email, name)`: Send password change confirmation
  - `sendEmailVerification(email, token, newEmail)`: Send email verification (future)

**PasswordResetService** (`server/services/auth/passwordResetService.ts`)
- Manages password reset tokens
- Implements rate limiting
- Methods:
  - `createResetToken(userId)`: Generate a new reset token
  - `validateToken(plainToken)`: Validate a reset token
  - `markTokenAsUsed(plainToken)`: Mark token as used
  - `invalidateUserTokens(userId)`: Invalidate all user tokens
  - `checkRateLimit(email)`: Check if email has exceeded rate limit
  - `cleanupExpiredTokens()`: Remove expired tokens

**AuthFacade** (`server/services/auth/AuthFacade.ts`)
- Extended with new methods:
  - `requestPasswordReset(email)`: Request password reset
  - `resetPasswordWithToken(token, newPassword)`: Reset password with token
  - `changePassword(email, currentPassword, newPassword)`: Change password
  - `updateProfile(email, name)`: Update user profile

#### 3. API Endpoints

**Password Reset Routes** (`server/routes/passwordResetRoutes.ts`)

- `POST /api/auth/forgot-password`: Request password reset
  - Body: `{ email: string }`
  - Response: Always success (prevents email enumeration)
  - Rate Limited: 3 requests per email per hour

- `GET /api/auth/verify-reset-token`: Verify reset token validity
  - Query: `?token=...`
  - Response: `{ valid: boolean }`

- `POST /api/auth/reset-password`: Reset password with token
  - Body: `{ token: string, newPassword: string }`
  - Validates password strength
  - Marks token as used

- `POST /api/auth/change-password`: Change password (requires authentication)
  - Body: `{ currentPassword: string, newPassword: string }`
  - Verifies current password
  - Validates new password strength

- `PATCH /api/auth/profile`: Update user profile (requires authentication)
  - Body: `{ name?: string }`
  - Updates user display name

### Frontend Components

#### 1. Pages

**ForgotPasswordPage** (`client/src/pages/ForgotPasswordPage.tsx`)
- Clean, user-friendly interface for requesting password reset
- Email input with validation
- Success state with helpful instructions
- Handles rate limiting errors gracefully

**ResetPasswordPage** (`client/src/pages/ResetPasswordPage.tsx`)
- Token verification on page load
- Password strength indicator
- Password requirements display
- Confirmation step for new password
- Auto-redirect to home after successful reset

**AccountSettingsPage** (`client/src/pages/AccountSettingsPage.tsx`)
- Tab-based interface:
  - **Profile Tab**: Update display name
  - **Security Tab**: Change password
- Real-time password strength feedback
- Success/error notifications
- Requires authentication

#### 2. Components

**LocalAuthForm** (`client/src/components/LocalAuthForm.tsx`)
- Added "Forgot Password?" link on login tab
- Links to `/forgot-password` page

## Usage

### For Users

#### Forgot Password Flow
1. Click "Forgot Password?" on login page
2. Enter your email address
3. Check your email for reset link
4. Click the link (valid for 1 hour)
5. Enter and confirm new password
6. Automatically redirected to login

#### Change Password
1. Navigate to `/account-settings`
2. Go to "Security" tab
3. Enter current password
4. Enter and confirm new password
5. Click "Update Password"

#### Update Profile
1. Navigate to `/account-settings`
2. Go to "Profile" tab
3. Update display name
4. Click "Save Changes"

### For Developers

#### Email Service Configuration
To enable actual email sending, configure an SMTP service or email provider:

```typescript
// server/services/auth/emailService.ts
// Update the EmailService constructor with your SMTP configuration
// Examples: SendGrid, AWS SES, Nodemailer with SMTP
```

#### Running Database Migrations
```bash
# Apply migrations
npm run db:push

# Or manually run the SQL files
mysql -u root -p < drizzle/0013_password_reset_tokens.sql
mysql -u root -p < drizzle/0014_email_verification_tokens.sql
```

#### Testing Password Reset
```bash
# 1. Start the development server
npm run dev

# 2. Register a new account or login with existing account

# 3. Test password reset:
#    - Navigate to /forgot-password
#    - Enter your email
#    - Check console logs for the reset link (since email is not configured)
#    - Copy the token from the logs
#    - Navigate to /reset-password?token=YOUR_TOKEN
#    - Complete the password reset

# 4. Test account settings:
#    - Navigate to /account-settings
#    - Update profile name
#    - Change password
```

## Security Considerations

1. **Token Storage**: Tokens are hashed using SHA-256 before storage
2. **Token Expiration**: Reset tokens expire after 1 hour
3. **Rate Limiting**: 3 password reset requests per email per hour
4. **Password Requirements**:
   - Minimum 8 characters
   - At least one uppercase letter
   - At least one lowercase letter
   - At least one number
   - At least one special character
5. **Email Enumeration Prevention**: Always returns success response
6. **Session Invalidation**: All reset tokens are invalidated after password change
7. **Current Password Verification**: Required when changing password while logged in

## Future Enhancements

1. **Email Verification**:
   - Verify email on registration
   - Verify email when changing email address
   - Schema already in place

2. **Two-Factor Authentication (2FA)**:
   - TOTP-based 2FA
   - Backup codes

3. **Session Management**:
   - View active sessions
   - Revoke sessions remotely
   - Login history

4. **Security Notifications**:
   - Email on new device login
   - Email on unusual activity
   - Email on email address change

5. **Account Deletion**:
   - Soft delete with grace period
   - Data export before deletion

## Troubleshooting

### Email Not Sending
- Check console logs - emails are logged in development mode
- Verify email service configuration
- Check SMTP credentials

### Token Invalid or Expired
- Tokens expire after 1 hour
- Tokens can only be used once
- Request a new password reset link

### Rate Limit Exceeded
- Wait 1 hour before requesting another reset
- Check if multiple requests were made accidentally

### Password Requirements Not Met
- Ensure password has:
  - At least 8 characters
  - Uppercase and lowercase letters
  - Numbers
  - Special characters (!@#$%^&* etc.)

## API Reference

### Password Reset Endpoints

#### Request Password Reset
```http
POST /api/auth/forgot-password
Content-Type: application/json

{
  "email": "user@example.com"
}

Response: 200 OK
{
  "success": true,
  "message": "If an account exists with this email, a password reset link has been sent."
}
```

#### Verify Reset Token
```http
GET /api/auth/verify-reset-token?token=abc123...

Response: 200 OK
{
  "valid": true,
  "message": "Token is valid"
}

Error: 400 Bad Request
{
  "error": "Invalid or expired token",
  "valid": false
}
```

#### Reset Password
```http
POST /api/auth/reset-password
Content-Type: application/json

{
  "token": "abc123...",
  "newPassword": "NewP@ssw0rd!"
}

Response: 200 OK
{
  "success": true,
  "message": "Password has been reset successfully"
}
```

#### Change Password
```http
POST /api/auth/change-password
Content-Type: application/json
Cookie: session_token=...

{
  "currentPassword": "OldP@ssw0rd!",
  "newPassword": "NewP@ssw0rd!"
}

Response: 200 OK
{
  "success": true,
  "message": "Password changed successfully"
}
```

#### Update Profile
```http
PATCH /api/auth/profile
Content-Type: application/json
Cookie: session_token=...

{
  "name": "John Doe"
}

Response: 200 OK
{
  "success": true,
  "profile": {
    "name": "John Doe"
  }
}
```

## Maintenance

### Cleanup Expired Tokens
```typescript
// Run periodically (e.g., daily cron job)
import { passwordResetService } from './server/services/auth/passwordResetService';

await passwordResetService.cleanupExpiredTokens();
```

### Monitor Rate Limits
Check application logs for rate limit violations:
```
[PasswordReset] Rate limit exceeded for email: user@example.com
```

## License

This feature is part of Healing Studio and follows the same license as the main project.
