/**
 * emailService.ts — Email notification service
 *
 * Handles sending transactional emails for password reset, email verification,
 * and security notifications.
 */

import { ENV } from "../../_core/env";
import { logger } from "../../_core/logger";

export type EmailTemplate =
  | "password-reset"
  | "password-changed"
  | "email-verification"
  | "email-changed"
  | "security-alert";

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Email service interface
 */
export class EmailService {
  private isConfigured: boolean;

  constructor() {
    // Check if email service is configured (placeholder for now)
    this.isConfigured = false; // Will be true when SMTP/service is configured
  }

  /**
   * Send an email
   */
  async send(options: EmailOptions): Promise<void> {
    if (!this.isConfigured) {
      // In development/demo mode, just log the email
      logger.info("[EmailService] Email would be sent (not configured)", {
        to: options.to,
        subject: options.subject,
      });
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("📧 Email Preview (not sent - service not configured)");
      console.log(`To: ${options.to}`);
      console.log(`Subject: ${options.subject}`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(options.text || options.html);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      return;
    }

    // TODO: Implement actual email sending with SMTP/SendGrid/AWS SES
    // For now, just log
    logger.info("[EmailService] Sending email", {
      to: options.to,
      subject: options.subject,
    });
  }

  /**
   * Send password reset email
   */
  async sendPasswordReset(email: string, resetToken: string): Promise<void> {
    const resetUrl = `${this.getBaseUrl()}/reset-password?token=${resetToken}`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #6b7280; }
          .code { background: #fff; border: 1px solid #e5e7eb; padding: 15px; border-radius: 6px; font-family: monospace; text-align: center; font-size: 18px; letter-spacing: 2px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔐 重置密碼</h1>
          </div>
          <div class="content">
            <p>您好，</p>
            <p>我們收到了您的密碼重置請求。點擊下方按鈕即可重置密碼：</p>
            <div style="text-align: center;">
              <a href="${resetUrl}" class="button">重置密碼</a>
            </div>
            <p>或者複製以下連結到瀏覽器：</p>
            <div class="code">${resetUrl}</div>
            <p><strong>此連結將在 1 小時後過期。</strong></p>
            <p>如果您沒有請求重置密碼，請忽略此郵件。您的帳號仍然安全。</p>
          </div>
          <div class="footer">
            <p>此郵件由 Healing Studio 自動發送，請勿直接回覆。</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `
重置密碼

您好，

我們收到了您的密碼重置請求。請訪問以下連結重置密碼：

${resetUrl}

此連結將在 1 小時後過期。

如果您沒有請求重置密碼，請忽略此郵件。您的帳號仍然安全。

---
此郵件由 Healing Studio 自動發送，請勿直接回覆。
    `.trim();

    await this.send({
      to: email,
      subject: "重置您的 Healing Studio 密碼",
      html,
      text,
    });
  }

  /**
   * Send password changed confirmation
   */
  async sendPasswordChanged(email: string, name?: string): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; }
          .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ 密碼已更新</h1>
          </div>
          <div class="content">
            <p>您好${name ? ` ${name}` : ""}，</p>
            <p>您的 Healing Studio 帳號密碼已成功更新。</p>
            <div class="alert">
              <strong>⚠️ 注意：</strong> 如果這不是您本人的操作，請立即聯繫我們的支援團隊。
            </div>
            <p>若有任何疑問，歡迎隨時聯繫我們。</p>
          </div>
          <div class="footer">
            <p>此郵件由 Healing Studio 自動發送，請勿直接回覆。</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `
密碼已更新

您好${name ? ` ${name}` : ""}，

您的 Healing Studio 帳號密碼已成功更新。

⚠️ 注意：如果這不是您本人的操作，請立即聯繫我們的支援團隊。

若有任何疑問，歡迎隨時聯繫我們。

---
此郵件由 Healing Studio 自動發送，請勿直接回覆。
    `.trim();

    await this.send({
      to: email,
      subject: "您的密碼已更新 - Healing Studio",
      html,
      text,
    });
  }

  /**
   * Send email verification token
   */
  async sendEmailVerification(email: string, token: string, newEmail: string): Promise<void> {
    const verifyUrl = `${this.getBaseUrl()}/verify-email?token=${token}`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .button { display: inline-block; background: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📧 驗證您的電子郵件</h1>
          </div>
          <div class="content">
            <p>您好，</p>
            <p>請驗證您的新電子郵件地址：<strong>${newEmail}</strong></p>
            <div style="text-align: center;">
              <a href="${verifyUrl}" class="button">驗證電子郵件</a>
            </div>
            <p>或者複製以下連結到瀏覽器：</p>
            <p style="background: #fff; border: 1px solid #e5e7eb; padding: 10px; border-radius: 4px; word-break: break-all;">${verifyUrl}</p>
            <p><strong>此連結將在 24 小時後過期。</strong></p>
          </div>
          <div class="footer">
            <p>此郵件由 Healing Studio 自動發送，請勿直接回覆。</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `
驗證您的電子郵件

您好，

請驗證您的新電子郵件地址：${newEmail}

訪問以下連結完成驗證：
${verifyUrl}

此連結將在 24 小時後過期。

---
此郵件由 Healing Studio 自動發送，請勿直接回覆。
    `.trim();

    await this.send({
      to: newEmail,
      subject: "驗證您的電子郵件 - Healing Studio",
      html,
      text,
    });
  }

  /**
   * Get base URL for links in emails
   */
  private getBaseUrl(): string {
    // In production, use the actual domain
    // For now, use localhost or environment variable
    return ENV.isProduction
      ? "https://healing-studio.app"  // TODO: Update with actual domain
      : "http://localhost:5173";
  }
}

export const emailService = new EmailService();
