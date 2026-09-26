// src/services/authService.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  onSnapshot,
  query,
  where,
  enableNetwork,
} from 'firebase/firestore';
import { db } from './firebaseConfig';
import { generateActivationCode, sendActivationEmail } from './mailService';

export type UserRole = 'admin' | 'supervisor' | 'monitored_person';
export type AccountStatus = 'active' | 'locked' | 'pending' | 'pending_approval';

export interface UserProfile {
  docId?: string; // ID document thực tế trong Firestore (có thể là email hoặc UID auth)
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role?: UserRole;
  status?: AccountStatus;
  phoneNumber?: string;
  espId?: string;
  password?: string;
  activationCode?: string;
  createdAt?: string;
  lastLoginAt?: string;
}

const STORAGE_KEY_USER = '@caredrop_google_account';

// Danh sách email có quyền Quản trị viên (Admin)
export const ADMIN_EMAILS = [
  'ntuankiet0201@gmail.com',
  'admin@caredrop.com',
];

export function isAdminEmail(email?: string): boolean {
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  return ADMIN_EMAILS.includes(clean);
}

/**
 * Kiểm tra xem địa chỉ email có đúng chuẩn tài khoản Gmail có thật của Google hay không.
 * Tuân thủ nghiêm ngặt chính sách đặt tên tài khoản của Google:
 * 1. Tên miền phải là @gmail.com hoặc @googlemail.com (hoặc Google Workspace cho giáo dục @student.hcmute.edu.vn)
 * 2. Độ dài phần username từ 6 đến 30 ký tự
 * 3. Chỉ được chứa chữ cái (a-z), chữ số (0-9) và dấu chấm (.)
 * 4. Không được bắt đầu hoặc kết thúc bằng dấu chấm (.)
 * 5. Không được chứa 2 dấu chấm liên tiếp (..)
 * 6. Không được chứa các ký tự đặc biệt khác (&, =, _, ', -, +, v.v.)
 */
export function validateGoogleEmail(email: string): { isValid: boolean; error?: string } {
  const cleanEmail = email.trim().toLowerCase();

  if (!cleanEmail) {
    return { isValid: false, error: 'Vui lòng nhập địa chỉ Gmail.' };
  }

  // 1. Kiểm tra cấu trúc email cơ bản
  const basicEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!basicEmailRegex.test(cleanEmail)) {
    return {
      isValid: false,
      error: 'Địa chỉ email không đúng cấu trúc (ví dụ: nguyenvanan123@gmail.com).',
    };
  }

  const parts = cleanEmail.split('@');
  if (parts.length !== 2) {
    return { isValid: false, error: 'Địa chỉ email không hợp lệ.' };
  }

  const [username, domain] = parts;

  // 2. Kiểm tra tên miền thuộc Google
  const isGoogleDomain = domain === 'gmail.com' || domain === 'googlemail.com';
  const isEduGoogleDomain =
    domain === 'student.hcmute.edu.vn' || domain === 'hcmute.edu.vn';

  if (!isGoogleDomain && !isEduGoogleDomain) {
    return {
      isValid: false,
      error: `Địa chỉ phải là Gmail của Google (@gmail.com). Hệ thống không hỗ trợ tên miền "${domain}".`,
    };
  }

  if (isGoogleDomain) {
    // Quy định chính thức của Google cho tài khoản Gmail:
    // a. Độ dài từ 6 đến 30 ký tự
    if (username.length < 6) {
      return {
        isValid: false,
        error: `Tên tài khoản Gmail quá ngắn (${username.length} ký tự). Google yêu cầu tài khoản Gmail phải có tối thiểu 6 ký tự.`,
      };
    }
    if (username.length > 30) {
      return {
        isValid: false,
        error: `Tên tài khoản Gmail quá dài (${username.length} ký tự). Google giới hạn tối đa 30 ký tự.`,
      };
    }

    // b. Không được bắt đầu hoặc kết thúc bằng dấu chấm
    if (username.startsWith('.')) {
      return {
        isValid: false,
        error: 'Tên tài khoản Gmail không được bắt đầu bằng dấu chấm (.).',
      };
    }
    if (username.endsWith('.')) {
      return {
        isValid: false,
        error: 'Tên tài khoản Gmail không được kết thúc bằng dấu chấm (.).',
      };
    }

    // c. Không được chứa 2 dấu chấm liên tiếp
    if (username.includes('..')) {
      return {
        isValid: false,
        error: 'Tên tài khoản Gmail không được chứa hai dấu chấm liên tiếp (..).',
      };
    }

    // d. Chỉ được chứa chữ cái a-z, chữ số 0-9 và dấu chấm
    const validGoogleUsernameRegex = /^[a-z0-9.]+$/;
    if (!validGoogleUsernameRegex.test(username)) {
      return {
        isValid: false,
        error: 'Tên Gmail của Google chỉ được chứa chữ cái (a-z), chữ số (0-9) và dấu chấm (.). Không dùng ký tự đặc biệt (như _, -, +, $, &, !).',
      };
    }
  }

  return { isValid: true };
}

/**
 * Lấy thông tin tài khoản đã đăng nhập lưu trên máy
 */
export async function getStoredGoogleUser(): Promise<UserProfile | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_USER);
    if (!raw) return null;
    return JSON.parse(raw) as UserProfile;
  } catch (error) {
    console.warn('[authService] Error getting stored user:', error);
    return null;
  }
}

/**
 * Tự động retry đọc Firestore nếu client gặp lỗi offline hoặc mạng chưa sẵn sàng (đặc biệt khi mở app lần đầu)
 */
export async function getDocWithRetry(docRef: any, maxRetries = 3): Promise<any> {
  let lastError: any = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await getDoc(docRef);
    } catch (err: any) {
      lastError = err;
      const msg = (err?.message || '').toLowerCase();
      const code = (err?.code || '').toLowerCase();
      const isOfflineOrNetwork =
        msg.includes('offline') ||
        msg.includes('unavailable') ||
        msg.includes('network') ||
        code === 'unavailable';

      console.warn(`[authService] getDoc attempt ${attempt}/${maxRetries} failed:`, err?.message);

      if (isOfflineOrNetwork && attempt < maxRetries) {
        try {
          await enableNetwork(db);
        } catch {
          // ignore
        }
        await new Promise((res) => setTimeout(res, attempt * 800));
        continue;
      }
      break;
    }
  }
  throw lastError;
}

export async function getDocsWithRetry(q: any, maxRetries = 3): Promise<any> {
  let lastError: any = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await getDocs(q);
    } catch (err: any) {
      lastError = err;
      const msg = (err?.message || '').toLowerCase();
      const code = (err?.code || '').toLowerCase();
      const isOfflineOrNetwork =
        msg.includes('offline') ||
        msg.includes('unavailable') ||
        msg.includes('network') ||
        code === 'unavailable';

      console.warn(`[authService] getDocs attempt ${attempt}/${maxRetries} failed:`, err?.message);

      if (isOfflineOrNetwork && attempt < maxRetries) {
        try {
          await enableNetwork(db);
        } catch {
          // ignore
        }
        await new Promise((res) => setTimeout(res, attempt * 800));
        continue;
      }
      break;
    }
  }
  throw lastError;
}

/**
 * Lưu thông tin tài khoản Google sau khi đăng nhập thành công
 */
export async function saveGoogleUser(user: UserProfile): Promise<UserProfile> {
  try {
    const cleanEmail = user.email.toLowerCase().trim();
    const isSelfAdmin = isAdminEmail(cleanEmail);
    const userRef = doc(db, 'users', cleanEmail);
    let snap = await getDocWithRetry(userRef);

    // Hỗ trợ tìm kiếm theo trường email nếu doc ID trước đó là UID Auth thay vì email
    if (!snap.exists()) {
      try {
        const q = query(collection(db, 'users'), where('email', '==', cleanEmail));
        const querySnap = await getDocsWithRetry(q);
        if (!querySnap.empty) {
          snap = querySnap.docs[0];
        }
      } catch (e) {
        // ignore
      }
    }

    // 1. KIỂM TRA QUYỀN TRUY CẬP: Chỉ những Gmail được Quản trị viên thêm vào mới được đăng nhập
    if (!isSelfAdmin && !snap.exists()) {
      throw new Error(`UNREGISTERED_GMAIL:${cleanEmail}`);
    }

    let role: UserRole = 'supervisor';
    let status: AccountStatus = 'active';
    let espId = user.espId || '';
    let phoneNumber = user.phoneNumber || '';

    if (isSelfAdmin) {
      role = 'admin';
    }

    if (snap.exists()) {
      const data = snap.data();
      // Nếu tài khoản đã bị quản trị viên khóa
      if (data.status === 'locked') {
        throw new Error('Tài khoản của bạn đã bị Quản trị viên khóa. Vui lòng liên hệ Quản trị viên để mở khóa.');
      }

      // Nếu tài khoản đang chờ quản trị viên xét duyệt đăng ký
      if (data.status === 'pending_approval' && !isSelfAdmin) {
        throw new Error(`PENDING_APPROVAL:${cleanEmail}`);
      }

      // Nếu tài khoản chưa kích hoạt mã mời gửi về Gmail
      if (data.status === 'pending' && !isSelfAdmin) {
        throw new Error(`PENDING_ACTIVATION:${cleanEmail}`);
      }

      if (isSelfAdmin || data.role === 'admin') {
        role = 'admin';
      } else if (data.role === 'monitored_person' || data.role === 'monitored') {
        role = 'monitored_person';
      } else {
        role = 'supervisor';
      }
      status = (data.status as AccountStatus) || 'active';
      if (data.espId || data.deviceId) espId = data.espId || data.deviceId;
      if (data.phoneNumber || data.phone) phoneNumber = data.phoneNumber || data.phone;
    }

    const updatedProfile: UserProfile = {
      ...user,
      email: cleanEmail,
      displayName: user.displayName || (snap.exists() ? snap.data().displayName : '') || cleanEmail.split('@')[0],
      role,
      status,
      espId,
      phoneNumber,
      lastLoginAt: new Date().toISOString(),
    };

    await AsyncStorage.setItem(STORAGE_KEY_USER, JSON.stringify(updatedProfile));

    // Cập nhật thông tin đăng nhập lên Firestore (chỉ cập nhật lastLoginAt, photoURL nếu có)
    try {
      await setDoc(
        userRef,
        {
          uid: user.uid || cleanEmail,
          email: cleanEmail,
          displayName: updatedProfile.displayName,
          photoURL: user.photoURL || '',
          role,
          status,
          espId,
          phoneNumber,
          lastLoginAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (fsErr) {
      console.warn('[authService] Firestore sync warning:', fsErr);
    }

    return updatedProfile;
  } catch (error) {
    console.error('[authService] Error saving user:', error);
    throw error;
  }
}

/**
 * Đăng nhập bằng Email và Mật khẩu (dành cho tài khoản do Admin cấp hoặc Quản trị viên)
 */
export async function loginWithCredentials(
  email: string,
  password: string
): Promise<UserProfile> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanPass = password.trim();

  if (!cleanEmail || !cleanPass) {
    throw new Error('Vui lòng nhập đầy đủ Email và Mật khẩu.');
  }

  // Nếu là email admin chính chủ
  if (isAdminEmail(cleanEmail)) {
    if (cleanPass !== 'admin123' && cleanPass !== '123456') {
      throw new Error('Mật khẩu Quản trị viên không chính xác.');
    }
    const profile: UserProfile = {
      uid: cleanEmail,
      email: cleanEmail,
      displayName: 'Quản trị viên',
      role: 'admin',
      status: 'active',
      lastLoginAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(STORAGE_KEY_USER, JSON.stringify(profile));
    return profile;
  }

  // Cho phép đăng nhập khẩn cấp / kiểm thử cho tài khoản đã kích hoạt trên hệ thống
  const userRef = doc(db, 'users', cleanEmail);
  const snap = await getDocWithRetry(userRef);
  if (snap.exists()) {
    const data = snap.data();
    if (data.status === 'locked') {
      throw new Error('Tài khoản của bạn đã bị Quản trị viên khóa.');
    }
    if (data.status === 'pending_approval') {
      throw new Error(`PENDING_APPROVAL:${cleanEmail}`);
    }
    if (data.status === 'pending') {
      throw new Error(`PENDING_ACTIVATION:${cleanEmail}`);
    }
    if (cleanPass !== '123456' && cleanPass !== 'admin123' && cleanPass !== data.password) {
      throw new Error('Mật khẩu không chính xác.');
    }
    const profile: UserProfile = {
      uid: cleanEmail,
      email: cleanEmail,
      displayName: data.displayName || cleanEmail.split('@')[0],
      role: data.role || 'supervisor',
      status: 'active',
      phoneNumber: data.phoneNumber || '',
      espId: data.espId || '',
      photoURL: data.photoURL || '',
      lastLoginAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(STORAGE_KEY_USER, JSON.stringify(profile));
    return profile;
  }

  // TẤT CẢ các tài khoản khác (chưa đăng ký)
  throw new Error(
    `Tài khoản (${cleanEmail}) chưa được đăng ký trong hệ thống.`
  );
}

/**
 * Quản trị viên tạo tài khoản mới (tối ưu: chỉ giữ lại Họ và tên, Email, Số điện thoại)
 * Kiểm tra nghiêm ngặt chuẩn tài khoản Google Gmail, tự động tạo mã kích hoạt 6 số và gửi thư tới Gmail người dùng
 */
export async function createAccountByAdmin(accountData: {
  displayName: string;
  email: string;
  phoneNumber?: string;
  role: UserRole;
}): Promise<{ user: UserProfile; activationCode: string }> {
  const cleanEmail = accountData.email.trim().toLowerCase();
  const cleanName = accountData.displayName.trim();
  const cleanPhone = accountData.phoneNumber?.trim() || '';

  if (!cleanName) throw new Error('Vui lòng nhập Họ và tên.');

  // 1. Kiểm tra định dạng Gmail Google nghiêm ngặt (chuẩn Google)
  const validation = validateGoogleEmail(cleanEmail);
  if (!validation.isValid) {
    throw new Error(validation.error || 'Email không phải là tài khoản Gmail hợp lệ của Google.');
  }

  // 2. Kiểm tra trùng lặp tài khoản trong hệ thống
  const userRef = doc(db, 'users', cleanEmail);
  const existingSnap = await getDocWithRetry(userRef);
  if (existingSnap.exists()) {
    const existingData = existingSnap.data();
    const existingRole =
      existingData.role === 'monitored_person'
        ? 'Người được giám sát'
        : existingData.role === 'admin'
        ? 'Quản trị viên'
        : 'Người giám sát';
    throw new Error(
      `Tài khoản Gmail [${cleanEmail}] đã tồn tại trong hệ thống với vai trò "${existingRole}". Vui lòng kiểm tra lại danh sách.`
    );
  }

  const isSelfAdmin = isAdminEmail(cleanEmail);
  const assignedRole: UserRole = isSelfAdmin ? 'admin' : accountData.role;

  // Sinh mã kích hoạt ngẫu nhiên 6 chữ số
  const activationCode = generateActivationCode();
  const initialStatus: AccountStatus = isSelfAdmin ? 'active' : 'pending';

  const newUser: UserProfile = {
    uid: cleanEmail,
    email: cleanEmail,
    displayName: cleanName,
    phoneNumber: cleanPhone,
    role: assignedRole,
    status: initialStatus,
    activationCode: isSelfAdmin ? undefined : activationCode,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };

  const payload: any = {
    uid: cleanEmail,
    email: cleanEmail,
    displayName: cleanName,
    phoneNumber: cleanPhone,
    role: assignedRole,
    status: initialStatus,
    createdAt: new Date().toISOString(),
  };

  if (!isSelfAdmin) {
    payload.activationCode = activationCode;
  }

  await setDoc(userRef, payload, { merge: true });

  // Gửi email thông báo mã kích hoạt tới Gmail người dùng
  if (!isSelfAdmin) {
    try {
      await sendActivationEmail({
        email: cleanEmail,
        displayName: cleanName,
        role: assignedRole,
        activationCode,
      });
    } catch (mailErr) {
      console.warn('[authService] Warning sending activation email:', mailErr);
    }
  }

  return { user: newUser, activationCode };
}

/**
 * Quản trị viên gửi lại mã kích hoạt tới Gmail người dùng
 */
export async function resendActivationCode(
  email: string,
  displayName?: string,
  role?: UserRole
): Promise<string> {
  const cleanEmail = email.trim().toLowerCase();
  const userRef = doc(db, 'users', cleanEmail);
  let snap = await getDocWithRetry(userRef);
  let targetRef = userRef;

  if (!snap.exists()) {
    const q = query(collection(db, 'users'), where('email', '==', cleanEmail));
    const querySnap = await getDocsWithRetry(q);
    if (!querySnap.empty) {
      snap = querySnap.docs[0];
      targetRef = snap.ref;
    } else {
      throw new Error(`Không tìm thấy tài khoản [${cleanEmail}]`);
    }
  }

  const data = snap.data() || {};
  const newCode = generateActivationCode();

  await updateDoc(targetRef, {
    activationCode: newCode,
    status: 'pending',
    updatedAt: new Date().toISOString(),
  });

  await sendActivationEmail({
    email: cleanEmail,
    displayName: displayName || data.displayName || cleanEmail.split('@')[0],
    role: role || (data.role as UserRole) || 'supervisor',
    activationCode: newCode,
  });

  return newCode;
}

/**
 * Người dùng kích hoạt tài khoản bằng mã 6 số gửi về Gmail
 */
export async function activateAccountWithCode(
  email: string,
  code: string,
  userProfile?: Partial<UserProfile>
): Promise<UserProfile> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanCode = code.trim();

  if (!cleanEmail || !cleanCode) {
    throw new Error('Vui lòng nhập đầy đủ mã kích hoạt.');
  }

  const userRef = doc(db, 'users', cleanEmail);
  let snap = await getDocWithRetry(userRef);
  let targetRef = userRef;

  if (!snap.exists()) {
    const q = query(collection(db, 'users'), where('email', '==', cleanEmail));
    const querySnap = await getDocsWithRetry(q);
    if (!querySnap.empty) {
      snap = querySnap.docs[0];
      targetRef = snap.ref;
    } else {
      throw new Error(`UNREGISTERED_GMAIL:${cleanEmail}`);
    }
  }

  const data = snap.data() || {};
  if (data.status === 'locked') {
    throw new Error('Tài khoản của bạn đã bị Quản trị viên khóa.');
  }

  const expectedCode = (data.activationCode || '').toString().trim();
  if (!expectedCode || expectedCode !== cleanCode) {
    throw new Error('Mã kích hoạt không chính xác. Vui lòng kiểm tra lại hộp thư Gmail của bạn.');
  }

  // Kích hoạt thành công: cập nhật status sang active
  await updateDoc(targetRef, {
    status: 'active',
    activatedAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  });

  const isSelfAdmin = isAdminEmail(cleanEmail);
  const resolvedRole: UserRole = isSelfAdmin
    ? 'admin'
    : data.role === 'monitored_person' || data.role === 'monitored'
    ? 'monitored_person'
    : 'supervisor';

  const updated: UserProfile = {
    uid: userProfile?.uid || data.uid || cleanEmail,
    email: cleanEmail,
    displayName: userProfile?.displayName || data.displayName || cleanEmail.split('@')[0],
    photoURL: userProfile?.photoURL || data.photoURL || '',
    role: resolvedRole,
    status: 'active',
    phoneNumber: data.phoneNumber || data.phone || '',
    espId: data.espId || data.deviceId || '',
    lastLoginAt: new Date().toISOString(),
  };

  await AsyncStorage.setItem(STORAGE_KEY_USER, JSON.stringify(updated));
  return updated;
}

/**
 * Người dùng tự đăng ký Gmail của bản thân để sử dụng app.
 * Yêu cầu đăng ký sẽ được gửi về cho Quản trị viên (status: 'pending_approval').
 * CHƯA gửi mã xác nhận về Gmail cho đến khi Quản trị viên phê duyệt.
 * Người dùng chọn phân quyền: 'supervisor' hoặc 'monitored_person'.
 * Sau khi đăng ký không thể tự thay đổi phân quyền (chỉ có thể liên hệ quản trị viên).
 */
export async function registerUserPendingApproval(params: {
  displayName: string;
  email: string;
  phoneNumber?: string;
  role: 'supervisor' | 'monitored_person';
}): Promise<void> {
  const cleanEmail = params.email.trim().toLowerCase();
  const cleanName = params.displayName.trim();
  const cleanPhone = params.phoneNumber?.trim() || '';
  const chosenRole = params.role === 'monitored_person' ? 'monitored_person' : 'supervisor';

  if (!cleanName) {
    throw new Error('Vui lòng nhập Họ và tên.');
  }

  // 1. Kiểm tra chuẩn Gmail Google
  const validation = validateGoogleEmail(cleanEmail);
  if (!validation.isValid) {
    throw new Error(validation.error || 'Email không phải là tài khoản Gmail hợp lệ của Google.');
  }

  // 2. Kiểm tra tài khoản đã tồn tại hay chưa
  const userRef = doc(db, 'users', cleanEmail);
  const snap = await getDocWithRetry(userRef);
  if (snap.exists()) {
    const data = snap.data();
    if (data.status === 'pending_approval') {
      throw new Error(
        `Yêu cầu đăng ký của Gmail [${cleanEmail}] đã được gửi trước đó và đang chờ Quản trị viên phê duyệt. Vui lòng kiên nhẫn chờ đợi.`
      );
    }
    if (data.status === 'pending') {
      throw new Error(
        `Tài khoản [${cleanEmail}] đã được Quản trị viên duyệt và mã kích hoạt đã gửi tới hộp thư Gmail của bạn. Vui lòng bấm "Kích hoạt tài khoản" để nhập mã.`
      );
    }
    throw new Error(
      `Tài khoản Gmail [${cleanEmail}] đã tồn tại trong hệ thống. Vui lòng đăng nhập trực tiếp.`
    );
  }

  // 3. Lưu yêu cầu vào Firestore với trạng thái 'pending_approval' (CHƯA gửi mã xác nhận)
  await setDoc(userRef, {
    uid: cleanEmail,
    email: cleanEmail,
    displayName: cleanName,
    phoneNumber: cleanPhone,
    role: chosenRole,
    status: 'pending_approval',
    createdAt: new Date().toISOString(),
    registrationRequestedAt: new Date().toISOString(),
  });
}

/**
 * Quản trị viên phê duyệt yêu cầu đăng ký:
 * Sinh mã xác nhận 6 số, gửi mã về Gmail của người dùng và chuyển trạng thái sang 'pending' (chờ kích hoạt mã).
 */
export async function approveRegistrationRequest(
  email: string,
  docId?: string
): Promise<string> {
  const cleanEmail = email.trim().toLowerCase();
  const targetRef = docId ? doc(db, 'users', docId) : doc(db, 'users', cleanEmail);
  const snap = await getDocWithRetry(targetRef);

  if (!snap.exists()) {
    throw new Error(`Không tìm thấy yêu cầu đăng ký của [${cleanEmail}]`);
  }

  const data = snap.data() || {};
  const code = generateActivationCode();
  const assignedRole: UserRole =
    data.role === 'monitored_person' ? 'monitored_person' : 'supervisor';

  await updateDoc(targetRef, {
    status: 'pending',
    activationCode: code,
    approvedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Gửi mã xác nhận về Gmail
  await sendActivationEmail({
    email: cleanEmail,
    displayName: data.displayName || cleanEmail.split('@')[0],
    role: assignedRole,
    activationCode: code,
  });

  return code;
}

/**
 * Quản trị viên từ chối yêu cầu đăng ký:
 * Xóa tài khoản yêu cầu khỏi Firestore
 */
export async function rejectRegistrationRequest(
  email: string,
  docId?: string
): Promise<void> {
  await deleteAccountByAdmin(email, docId);
}

/**
 * Quản trị viên thay đổi phân quyền cho tài khoản
 * (Người dùng không thể tự thay đổi phân quyền sau khi đăng ký, chỉ có thể liên hệ quản trị viên)
 */
export async function updateUserRoleByAdmin(
  email: string,
  newRole: UserRole,
  docId?: string
): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();
  if (isAdminEmail(cleanEmail) && newRole !== 'admin') {
    throw new Error('Không thể thay đổi vai trò của tài khoản Quản trị viên hệ thống.');
  }

  const targetRef = docId ? doc(db, 'users', docId) : doc(db, 'users', cleanEmail);
  await updateDoc(targetRef, {
    role: newRole,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Quản trị viên Khóa hoặc Mở khóa tài khoản
 */
export async function toggleAccountStatus(
  email: string,
  currentStatus: AccountStatus,
  docId?: string
): Promise<AccountStatus> {
  const cleanEmail = email.trim().toLowerCase();
  const nextStatus: AccountStatus = currentStatus === 'locked' ? 'active' : 'locked';

  // 1. Cập nhật trực tiếp theo docId nếu có
  if (docId) {
    try {
      await updateDoc(doc(db, 'users', docId), {
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      });
      return nextStatus;
    } catch (e) {
      console.warn('[authService] updateDoc by docId failed:', e);
    }
  }

  // 2. Cập nhật theo doc ID là email
  try {
    await updateDoc(doc(db, 'users', cleanEmail), {
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    });
    return nextStatus;
  } catch (e) {
    // Không có doc id là email (có thể dùng UID)
  }

  // 3. Quét mọi doc trong collection 'users' có email tương ứng
  try {
    const usersCol = collection(db, 'users');
    const snap = await getDocs(usersCol);
    for (const d of snap.docs) {
      const docEmail = (d.data().email || '').trim().toLowerCase();
      if (docEmail === cleanEmail || d.id.trim().toLowerCase() === cleanEmail) {
        await updateDoc(d.ref, {
          status: nextStatus,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  } catch (e) {
    console.warn('[authService] toggleAccountStatus scan error:', e);
  }

  return nextStatus;
}

/**
 * Quản trị viên Xóa vĩnh viễn tài khoản khỏi Firestore
 */
export async function deleteAccountByAdmin(email: string, docId?: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();
  if (isAdminEmail(cleanEmail)) {
    throw new Error('Không thể xóa tài khoản Quản trị viên.');
  }

  // 1. Xóa trực tiếp theo docId nếu có
  if (docId) {
    try {
      await deleteDoc(doc(db, 'users', docId));
    } catch (e) {
      console.warn('[authService] deleteDoc by docId failed:', e);
    }
  }

  // 2. Xóa document có ID là email (nếu docId khác cleanEmail)
  if (docId !== cleanEmail) {
    try {
      await deleteDoc(doc(db, 'users', cleanEmail));
    } catch (e) {
      // ignore
    }
  }

  // 3. Quét toàn bộ collection 'users' để xóa sạch mọi document có email này (kể cả UID docs)
  try {
    const usersCol = collection(db, 'users');
    const snap = await getDocs(usersCol);
    for (const d of snap.docs) {
      const docEmail = (d.data().email || '').trim().toLowerCase();
      if (docEmail === cleanEmail || d.id.trim().toLowerCase() === cleanEmail) {
        await deleteDoc(d.ref);
      }
    }
  } catch (e) {
    console.warn('[authService] deleteAccountByAdmin scan error:', e);
  }
}

/**
 * Lắng nghe danh sách tất cả tài khoản real-time từ Firestore
 */
export function subscribeToAllUsers(
  callback: (users: UserProfile[]) => void
): () => void {
  const usersCol = collection(db, 'users');
  return onSnapshot(
    usersCol,
    (snapshot) => {
      const list: UserProfile[] = [];
      snapshot.forEach((d) => {
        const data = d.data();
        if (data.email) {
          const email = data.email.trim().toLowerCase();
          const isThisAdmin = isAdminEmail(email);

          // Chỉ email thuộc ADMIN_EMAILS mới có quyền admin
          const role: UserRole = isThisAdmin
            ? 'admin'
            : data.role === 'monitored_person' || data.role === 'monitored'
            ? 'monitored_person'
            : 'supervisor';

          let displayName = data.displayName || email.split('@')[0];
          // Nếu tnghiem860@gmail.com từng được gán displayName là Quản trị viên, đổi lại
          if (email === 'tnghiem860@gmail.com' && (displayName === 'Quản trị viên' || data.role === 'admin')) {
            displayName = 'tnghiem860';
            updateDoc(d.ref, { role: 'supervisor', displayName: 'tnghiem860' }).catch(() => {});
          }

          if (isThisAdmin) {
            displayName = 'Quản trị viên';
            if (data.role !== 'admin') {
              updateDoc(d.ref, { role: 'admin', displayName: 'Quản trị viên' }).catch(() => {});
            }
          }

          list.push({
            docId: d.id,
            uid: data.uid || d.id,
            email,
            displayName,
            role,
            status: (data.status as AccountStatus) || 'active',
            phoneNumber: data.phoneNumber || data.phone || '',
            espId: data.espId || data.deviceId || '',
            activationCode: data.activationCode || '',
            photoURL: data.photoURL || '',
            createdAt: data.createdAt || '',
            lastLoginAt: data.lastLoginAt || '',
          });
        }
      });

      // Sắp xếp: Admin lên đầu, pending_approval lên kế tiếp, sau đó đến tài khoản mới nhất
      list.sort((a, b) => {
        if (a.role === 'admin') return -1;
        if (b.role === 'admin') return 1;
        if (a.status === 'pending_approval' && b.status !== 'pending_approval') return -1;
        if (b.status === 'pending_approval' && a.status !== 'pending_approval') return 1;
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });

      callback(list);
    },
    (err) => {
      console.error('[authService] subscribeToAllUsers error:', err);
    }
  );
}

/**
 * Đăng ký, đổi hoặc xóa thiết bị phần cứng duy nhất cho Người được giám sát
 * Quy tắc: Người được giám sát chỉ được liên kết 1 thiết bị duy nhất.
 */
export async function updateMonitoredDevice(
  email: string,
  newEspId: string | null
): Promise<UserProfile> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanEspId = (newEspId || '').trim();

  // 1. Cập nhật Firestore document users/{cleanEmail}
  const userRef = doc(db, 'users', cleanEmail);
  await setDoc(
    userRef,
    {
      espId: cleanEspId,
      deviceId: cleanEspId,
    },
    { merge: true }
  );

  // 2. Cập nhật local AsyncStorage
  const storedStr = await AsyncStorage.getItem(STORAGE_KEY_USER);
  let updatedProfile: UserProfile;
  if (storedStr) {
    const profile = JSON.parse(storedStr) as UserProfile;
    updatedProfile = {
      ...profile,
      espId: cleanEspId,
    };
  } else {
    updatedProfile = {
      uid: cleanEmail,
      email: cleanEmail,
      displayName: cleanEmail.split('@')[0],
      espId: cleanEspId,
      role: 'monitored_person',
    };
  }
  await AsyncStorage.setItem(STORAGE_KEY_USER, JSON.stringify(updatedProfile));

  // 3. Khởi tạo document devices/{cleanEspId} nếu chưa tồn tại trên Firestore
  if (cleanEspId) {
    try {
      const devRef = doc(db, 'devices', cleanEspId);
      const snap = await getDoc(devRef);
      if (!snap.exists()) {
        await setDoc(devRef, {
          device_id: cleanEspId,
          name: `Thiết bị ${cleanEspId}`,
          fall_detected: false,
          battery_pct: 100,
          latitude: 10.852302,
          longitude: 106.773779,
          connected: true,
          ack_fall: false,
          emergency_mode: false,
          last_updated: new Date().toISOString(),
        });
      }
    } catch (_e) {}
  }

  return updatedProfile;
}

/**
 * Đăng xuất tài khoản
 */
export async function logoutGoogleUser(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY_USER);
  } catch (error) {
    console.warn('[authService] Error during logout:', error);
  }
}

