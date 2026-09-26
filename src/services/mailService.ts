// src/services/mailService.ts
import { doc, getDoc, setDoc, collection } from 'firebase/firestore';
import { db } from './firebaseConfig';
import { UserRole } from './authService';

/**
 * Cấu hình hệ thống gửi mail
 */
export interface MailConfig {
  gasUrl?: string; // URL Google Apps Script Web App (Khuyên dùng - 100% miễn phí vĩnh viễn)
  emailjsServiceId?: string;
  emailjsTemplateId?: string;
  emailjsPublicKey?: string;
  updatedAt?: string;
}

export const DEFAULT_GAS_URL =
  'https://script.google.com/macros/s/AKfycbxNzaPZhjPi7G5tVxJGR814e7U_apHmkwAWe4XRHRESmyLDxMYZlbj-wRauRTXUnfYFkA/exec';

// Bộ nhớ cache cục bộ để tăng tốc độ gửi mail
let cachedMailConfig: MailConfig | null = { gasUrl: DEFAULT_GAS_URL };

/**
 * Đọc cấu hình gửi mail từ Firestore (collection 'system_config', doc 'mail')
 */
export async function getMailConfig(): Promise<MailConfig> {
  if (cachedMailConfig && cachedMailConfig.gasUrl) return cachedMailConfig;
  try {
    const cfgRef = doc(db, 'system_config', 'mail');
    const snap = await getDoc(cfgRef);
    if (snap.exists()) {
      cachedMailConfig = snap.data() as MailConfig;
      if (!cachedMailConfig.gasUrl) {
        cachedMailConfig.gasUrl = DEFAULT_GAS_URL;
      }
      return cachedMailConfig;
    }
  } catch (err) {
    console.warn('[mailService] Error fetching mail config from Firestore:', err);
  }
  cachedMailConfig = { gasUrl: DEFAULT_GAS_URL };
  return cachedMailConfig;
}

/**
 * Lưu cấu hình gửi mail vào Firestore
 */
export async function saveMailConfig(config: Partial<MailConfig>): Promise<void> {
  const cfgRef = doc(db, 'system_config', 'mail');
  const payload = {
    ...config,
    updatedAt: new Date().toISOString(),
  };
  await setDoc(cfgRef, payload, { merge: true });
  cachedMailConfig = { ...(cachedMailConfig || {}), ...payload };
}

/**
 * Sinh mã kích hoạt ngẫu nhiên gồm 6 chữ số
 */
export function generateActivationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export interface SendMailParams {
  email: string;
  displayName: string;
  role: UserRole;
  activationCode: string;
}

export interface SendMailResult {
  success: boolean;
  method: string;
  message?: string;
}

/**
 * Gửi email chứa mã kích hoạt tới Gmail của người dùng
 */
export async function sendActivationEmail(params: SendMailParams): Promise<SendMailResult> {
  const cleanEmail = params.email.trim().toLowerCase();
  const cleanName = params.displayName.trim() || cleanEmail.split('@')[0];

  const roleLabel =
    params.role === 'monitored_person'
      ? 'Người được giám sát'
      : params.role === 'admin'
      ? 'Quản trị viên'
      : 'Người giám sát';

  const subject = `Mã kích hoạt tài khoản CareDrop của bạn: ${params.activationCode}`;
  const textMessage = `Xin chào ${cleanName},\n\nBạn đã được Quản trị viên cấp phép tham gia hệ thống CareDrop với vai trò: ${roleLabel}.\n\nMã kích hoạt tài khoản của bạn là: ${params.activationCode}\n\nVui lòng mở ứng dụng CareDrop trên điện thoại, đăng nhập bằng Gmail (${cleanEmail}) và nhập mã kích hoạt trên để bắt đầu sử dụng.\n\nTrân trọng,\nĐội ngũ CareDrop Support`;

  const htmlMessage = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>CareDrop Activation</title>
</head>
<body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9;">
  <div style="max-width: 540px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    <div style="background-color: #007AFF; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.5px;">CareDrop</h1>
      <p style="color: #e0f2fe; margin: 6px 0 0; font-size: 13px;">Hệ thống giám sát và phát hiện té ngã thông minh</p>
    </div>

    <div style="padding: 28px 24px;">
      <p style="font-size: 15px; color: #1e293b; margin: 0 0 16px;">Xin chào <strong>${cleanName}</strong>,</p>
      
      <p style="font-size: 14px; color: #334155; line-height: 1.6; margin: 0 0 20px;">
        Quản trị viên đã cấp quyền cho tài khoản <strong>${cleanEmail}</strong> tham gia hệ thống CareDrop với vai trò:
        <span style="display: inline-block; background-color: #e0f2fe; color: #0284c7; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 13px;">${roleLabel}</span>
      </p>

      <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
        <div style="font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Mã kích hoạt tài khoản của bạn</div>
        <div style="font-size: 32px; font-weight: 800; color: #007AFF; letter-spacing: 8px; font-family: monospace;">${params.activationCode}</div>
      </div>

      <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px 16px; margin-bottom: 24px;">
        <p style="font-size: 13px; color: #166534; margin: 0; line-height: 1.5;">
          <strong>Hướng dẫn kích hoạt:</strong> Mở ứng dụng <strong>CareDrop</strong> trên điện thoại &gt; Đăng nhập bằng Gmail <strong>${cleanEmail}</strong> &gt; Nhập mã số trên để hoàn tất kích hoạt.
        </p>
      </div>

      <p style="font-size: 12px; color: #94a3b8; line-height: 1.5; margin: 0; text-align: center;">
        Nếu bạn không yêu cầu mã này, vui lòng bỏ qua email hoặc liên hệ Quản trị viên.<br/>
        Email tự động từ hệ thống CareDrop.
      </p>
    </div>
  </div>
</body>
</html>`;

  // 1. Lưu bản ghi lời mời vào Firestore collection 'invitations' để tra cứu
  try {
    const invRef = doc(db, 'invitations', cleanEmail);
    await setDoc(invRef, {
      email: cleanEmail,
      displayName: cleanName,
      role: params.role,
      roleLabel,
      activationCode: params.activationCode,
      status: 'pending',
      subject,
      textMessage,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[mailService] Could not write to invitations collection:', err);
  }

  // 2. Gửi qua Firebase Trigger Email extension nếu được kích hoạt (collection 'mail')
  try {
    const mailRef = doc(collection(db, 'mail'));
    await setDoc(mailRef, {
      to: cleanEmail,
      message: {
        subject,
        text: textMessage,
        html: htmlMessage,
      },
    });
  } catch (err) {
    console.warn('[mailService] Could not write to mail collection:', err);
  }

  // Lấy cấu hình gửi mail hiện tại
  const config = await getMailConfig();
  let delivered = false;
  let deliveryMethod = 'none';

  // 3. Ưu tiên 1: Gửi qua Google Apps Script Web App (Tự động gửi trực tiếp từ hòm thư Gmail tới hòm thư người nhận)
  const targetGasUrl = (config.gasUrl || DEFAULT_GAS_URL).trim();
  if (targetGasUrl.startsWith('http')) {
    try {
      const response = await fetch(targetGasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          to: cleanEmail,
          subject,
          text: textMessage,
          html: htmlMessage,
          senderName: 'CareDrop Support',
          activationCode: params.activationCode,
          displayName: cleanName,
          role: roleLabel,
        }),
      });
      if (response.ok) {
        console.log('[mailService] Successfully sent via Google Apps Script Webhook');
        delivered = true;
        deliveryMethod = 'Google Apps Script';
      } else {
        console.warn('[mailService] Google Apps Script responded with status:', response.status);
      }
    } catch (gasErr) {
      console.warn('[mailService] Error calling Google Apps Script Webhook:', gasErr);
    }
  }

  // 4. Ưu tiên 2: Gửi qua EmailJS nếu có cấu hình
  if (!delivered && config.emailjsPublicKey && config.emailjsServiceId && config.emailjsTemplateId) {
    try {
      const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: config.emailjsServiceId,
          template_id: config.emailjsTemplateId,
          user_id: config.emailjsPublicKey,
          template_params: {
            to_email: cleanEmail,
            to_name: cleanName,
            role_label: roleLabel,
            activation_code: params.activationCode,
            subject,
            message: textMessage,
          },
        }),
      });
      if (response.ok) {
        delivered = true;
        deliveryMethod = 'EmailJS';
      }
    } catch (ejsErr) {
      console.warn('[mailService] Error calling EmailJS:', ejsErr);
    }
  }

  return {
    success: delivered,
    method: deliveryMethod,
    message: delivered
      ? `Đã gửi mã thành công tới hòm thư ${cleanEmail} qua ${deliveryMethod}`
      : `Đã lưu mã kích hoạt vào hệ thống. Cần thiết lập URL Google Apps Script để gửi thư tự động tới hòm thư Gmail.`,
  };
}

/**
 * Gửi email thử nghiệm tới một địa chỉ Gmail bất kỳ để kiểm tra kết nối
 */
export async function testSendEmail(targetEmail: string): Promise<SendMailResult> {
  return sendActivationEmail({
    email: targetEmail,
    displayName: 'Người kiểm tra hệ thống',
    role: 'supervisor',
    activationCode: generateActivationCode(),
  });
}

