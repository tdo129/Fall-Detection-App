// src/services/authService.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  onSnapshot,
} from 'firebase/firestore';
import { db } from './firebaseConfig';

export type UserRole = 'admin' | 'supervisor' | 'monitored_person';
export type AccountStatus = 'active' | 'locked';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role?: UserRole;
  status?: AccountStatus;
  phoneNumber?: string;
  espId?: string;
  password?: string;
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
 * Lưu thông tin tài khoản Google sau khi đăng nhập thành công
 */
export async function saveGoogleUser(user: UserProfile): Promise<UserProfile> {
  try {
    const cleanEmail = user.email.toLowerCase().trim();
    const userRef = doc(db, 'users', cleanEmail);
    const snap = await getDoc(userRef);

    let role: UserRole = 'supervisor';
    let status: AccountStatus = 'active';
    let espId = user.espId || '';
    let phoneNumber = user.phoneNumber || '';

    if (isAdminEmail(cleanEmail)) {
      role = 'admin';
    }

    if (snap.exists()) {
      const data = snap.data();
      // Nếu tài khoản đã bị quản trị viên khóa
      if (data.status === 'locked') {
        throw new Error('Tài khoản của bạn đã bị Quản trị viên khóa. Vui lòng liên hệ quản trị viên để mở khóa.');
      }

      if (isAdminEmail(cleanEmail)) {
        role = 'admin';
      } else if (data.role && data.role !== 'admin') {
        role = data.role as UserRole;
      } else {
        role = 'supervisor';
      }
      status = (data.status as AccountStatus) || 'active';
      if (data.espId) espId = data.espId;
      if (data.phoneNumber) phoneNumber = data.phoneNumber;
    }

    const updatedProfile: UserProfile = {
      ...user,
      email: cleanEmail,
      role,
      status,
      espId,
      phoneNumber,
      lastLoginAt: new Date().toISOString(),
    };

    await AsyncStorage.setItem(STORAGE_KEY_USER, JSON.stringify(updatedProfile));

    // Đồng bộ lên Firestore users/{email}
    try {
      await setDoc(
        userRef,
        {
          uid: user.uid || cleanEmail,
          email: cleanEmail,
          displayName: user.displayName || cleanEmail.split('@')[0],
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

  const userRef = doc(db, 'users', cleanEmail);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    throw new Error('Tài khoản không tồn tại trên hệ thống. Vui lòng liên hệ Quản trị viên.');
  }

  const data = snap.data();
  if (data.status === 'locked') {
    throw new Error('Tài khoản của bạn đã bị Quản trị viên khóa. Vui lòng liên hệ Quản trị viên để mở khóa.');
  }

  if (data.password && data.password !== cleanPass) {
    throw new Error('Mật khẩu đăng nhập không chính xác.');
  }

  const profile: UserProfile = {
    uid: data.uid || cleanEmail,
    email: cleanEmail,
    displayName: data.displayName || cleanEmail.split('@')[0],
    role: (data.role as UserRole) || 'supervisor',
    status: (data.status as AccountStatus) || 'active',
    phoneNumber: data.phoneNumber || '',
    espId: data.espId || '',
    photoURL: data.photoURL || '',
    lastLoginAt: new Date().toISOString(),
  };

  await AsyncStorage.setItem(STORAGE_KEY_USER, JSON.stringify(profile));
  return profile;
}

/**
 * Quản trị viên tạo tài khoản mới
 */
export async function createAccountByAdmin(accountData: {
  displayName: string;
  email: string;
  password: string;
  phoneNumber?: string;
  espId?: string;
  role: UserRole;
}): Promise<UserProfile> {
  const cleanEmail = accountData.email.trim().toLowerCase();
  const cleanName = accountData.displayName.trim();
  const cleanPass = accountData.password.trim();
  const cleanPhone = accountData.phoneNumber?.trim() || '';
  const cleanEsp = accountData.espId?.trim().toUpperCase() || '';

  if (!cleanName) throw new Error('Vui lòng nhập Họ và tên.');
  if (!cleanEmail || !cleanEmail.includes('@')) throw new Error('Email không hợp lệ.');
  if (!cleanPass || cleanPass.length < 6) throw new Error('Mật khẩu tạm thời tối thiểu 6 ký tự.');

  const userRef = doc(db, 'users', cleanEmail);
  const existing = await getDoc(userRef);

  const isSelfAdmin = isAdminEmail(cleanEmail);
  const assignedRole: UserRole = isSelfAdmin ? 'admin' : accountData.role;

  const newUser: UserProfile = {
    uid: cleanEmail,
    email: cleanEmail,
    displayName: cleanName,
    password: cleanPass,
    phoneNumber: cleanPhone,
    espId: cleanEsp,
    role: assignedRole,
    status: 'active',
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };

  const payload: any = {
    uid: cleanEmail,
    email: cleanEmail,
    displayName: cleanName,
    password: cleanPass,
    phoneNumber: cleanPhone,
    espId: cleanEsp,
    role: assignedRole,
    status: 'active',
    createdAt: new Date().toISOString(),
  };

  // Nếu có mã ESP, tự động tạo cặp thiết bị sẵn sàng
  if (cleanEsp) {
    payload.pairedDevices = [
      {
        id: cleanEsp,
        name: `${cleanName} (${cleanEsp})`,
        addedAt: new Date().toISOString(),
      },
    ];

    // Tạo luôn document devices/{espId} trên Firestore nếu chưa có
    try {
      const devRef = doc(db, 'devices', cleanEsp);
      const devSnap = await getDoc(devRef);
      if (!devSnap.exists()) {
        await setDoc(devRef, {
          device_id: cleanEsp,
          name: `${cleanName} (${cleanEsp})`,
          fall_detected: false,
          battery_pct: 100,
          latitude: 10.8505,
          longitude: 106.7739,
          fall_time: new Date().toISOString(),
          connected: true,
          ack_fall: false,
          emergency_mode: false,
          last_updated: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.warn('[authService] Could not pre-create device doc:', e);
    }
  }

  await setDoc(userRef, payload, { merge: true });
  return newUser;
}

/**
 * Quản trị viên Khóa hoặc Mở khóa tài khoản
 */
export async function toggleAccountStatus(
  email: string,
  currentStatus: AccountStatus
): Promise<AccountStatus> {
  const cleanEmail = email.trim().toLowerCase();
  const nextStatus: AccountStatus = currentStatus === 'locked' ? 'active' : 'locked';

  const userRef = doc(db, 'users', cleanEmail);
  await updateDoc(userRef, {
    status: nextStatus,
    updatedAt: new Date().toISOString(),
  });

  return nextStatus;
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
            : data.role === 'monitored_person'
            ? 'monitored_person'
            : 'supervisor';

          let displayName = data.displayName || email.split('@')[0];
          // Nếu tnghiem860@gmail.com từng được gán displayName là Quản trị viên, đổi lại
          if (email === 'tnghiem860@gmail.com' && (displayName === 'Quản trị viên' || data.role === 'admin')) {
            displayName = 'tnghiem860';
            updateDoc(doc(db, 'users', email), { role: 'supervisor', displayName: 'tnghiem860' }).catch(() => {});
          }

          if (isThisAdmin) {
            displayName = 'Quản trị viên';
            if (data.role !== 'admin') {
              updateDoc(doc(db, 'users', email), { role: 'admin', displayName: 'Quản trị viên' }).catch(() => {});
            }
          }

          list.push({
            uid: data.uid || email,
            email,
            displayName,
            role,
            status: (data.status as AccountStatus) || 'active',
            phoneNumber: data.phoneNumber || '',
            espId: data.espId || '',
            photoURL: data.photoURL || '',
            createdAt: data.createdAt || '',
            lastLoginAt: data.lastLoginAt || '',
          });
        }
      });

      // Sắp xếp: Admin lên đầu hoặc tài khoản mới nhất lên đầu
      list.sort((a, b) => {
        if (a.role === 'admin') return -1;
        if (b.role === 'admin') return 1;
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
 * Đăng xuất tài khoản
 */
export async function logoutGoogleUser(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY_USER);
  } catch (error) {
    console.warn('[authService] Error during logout:', error);
  }
}
