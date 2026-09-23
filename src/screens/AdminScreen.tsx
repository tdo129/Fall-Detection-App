// src/screens/AdminScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import {
  UserProfile,
  UserRole,
  AccountStatus,
  subscribeToAllUsers,
  createAccountByAdmin,
  toggleAccountStatus,
  isAdminEmail,
} from '../services/authService';

export default function AdminScreen() {
  const { user, logout } = useAuth();

  // State quản lý form tạo tài khoản
  const [selectedRole, setSelectedRole] = useState<UserRole>('monitored_person');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [espId, setEspId] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // State danh sách tài khoản
  const [accounts, setAccounts] = useState<UserProfile[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [processingEmail, setProcessingEmail] = useState<string | null>(null);

  // Lắng nghe real-time danh sách tài khoản Firestore
  useEffect(() => {
    const unsubscribe = subscribeToAllUsers((list) => {
      setAccounts(list);
      setLoadingAccounts(false);
    });
    return () => unsubscribe();
  }, []);

  // Tính số lượng thống kê theo vai trò
  const supervisorCount = accounts.filter((a) => a.role === 'supervisor').length;
  const monitoredCount = accounts.filter((a) => a.role === 'monitored_person').length;

  // Xử lý tạo tài khoản mới
  const handleCreateAccount = async () => {
    if (!fullName.trim()) {
      Alert.alert('Chưa nhập thông tin', 'Vui lòng nhập Họ và tên.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      Alert.alert('Email không hợp lệ', 'Vui lòng nhập đúng định dạng email đăng nhập.');
      return;
    }
    if (!password.trim() || password.trim().length < 6) {
      Alert.alert('Mật khẩu yếu', 'Mật khẩu tạm thời phải có tối thiểu 6 ký tự.');
      return;
    }

    setIsCreating(true);
    try {
      await createAccountByAdmin({
        displayName: fullName.trim(),
        email: email.trim().toLowerCase(),
        password: password.trim(),
        phoneNumber: phone.trim(),
        espId: espId.trim().toUpperCase(),
        role: selectedRole,
      });

      Alert.alert(
        'Tạo tài khoản thành công! 🎉',
        `Tài khoản [${email.trim().toLowerCase()}] với vai trò "${
          selectedRole === 'monitored_person' ? 'Người được giám sát' : 'Người giám sát'
        }" đã được thêm vào hệ thống.`
      );

      // Reset form
      setFullName('');
      setEmail('');
      setPassword('');
      setPhone('');
      setEspId('');
    } catch (err: any) {
      Alert.alert('Lỗi tạo tài khoản', err.message || 'Không thể tạo tài khoản trên hệ thống.');
    } finally {
      setIsCreating(false);
    }
  };

  // Xử lý Khóa / Mở khóa tài khoản
  const handleToggleLock = (targetUser: UserProfile) => {
    const isLocked = targetUser.status === 'locked';
    const actionText = isLocked ? 'Mở khóa' : 'Khóa';

    // Không cho phép tự khóa chính mình hoặc khóa tài khoản Quản trị viên
    if (
      targetUser.email.toLowerCase() === user?.email.toLowerCase() ||
      isAdminEmail(targetUser.email)
    ) {
      Alert.alert('Không thể thực hiện', 'Bạn không thể khóa tài khoản quản trị viên.');
      return;
    }

    Alert.alert(
      `Xác nhận ${actionText}`,
      `Bạn có chắc chắn muốn ${actionText.toLowerCase()} tài khoản [${targetUser.email}] không?`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: actionText,
          style: isLocked ? 'default' : 'destructive',
          onPress: async () => {
            setProcessingEmail(targetUser.email);
            try {
              const newStatus = await toggleAccountStatus(
                targetUser.email,
                targetUser.status || 'active'
              );
              Alert.alert(
                'Thành công',
                `Đã ${newStatus === 'locked' ? 'khóa' : 'mở khóa'} tài khoản [${targetUser.email}].`
              );
            } catch (e: any) {
              Alert.alert('Lỗi', e.message || 'Không thể cập nhật trạng thái tài khoản.');
            } finally {
              setProcessingEmail(null);
            }
          },
        },
      ]
    );
  };

  // Xử lý đăng xuất
  const handleLogout = () => {
    Alert.alert('Đăng xuất Quản trị viên', 'Bạn có muốn đăng xuất khỏi trang quản trị hệ thống không?', [
      { text: 'Hủy', style: 'cancel' },
      { text: 'Đăng xuất', style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F4F8FD" />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── HEADER ── */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.headerSubtitle}>QUẢN TRỊ HỆ THỐNG</Text>
              <Text style={styles.headerTitle}>Xin chào, Quản trị viên</Text>
            </View>
            <TouchableOpacity
              style={styles.logoutBtn}
              onPress={handleLogout}
              activeOpacity={0.7}
            >
              <Text style={styles.logoutText}>Đăng xuất</Text>
            </TouchableOpacity>
          </View>

          {/* ── STATS CARDS ── */}
          <View style={styles.statsRow}>
            {/* Card 1: Người giám sát */}
            <View style={styles.statCard}>
              <Text style={[styles.statNumber, { color: '#007AFF' }]}>
                {supervisorCount}
              </Text>
              <Text style={styles.statLabel}>Người giám sát</Text>
            </View>

            {/* Card 2: Người được giám sát */}
            <View style={styles.statCard}>
              <Text style={[styles.statNumber, { color: '#10B981' }]}>
                {monitoredCount}
              </Text>
              <Text style={styles.statLabel}>Người được giám sát</Text>
            </View>
          </View>

          {/* ── CARD 1: TẠO TÀI KHOẢN MỚI ── */}
          <View style={styles.cardContainer}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>Tạo tài khoản mới</Text>
              <TouchableOpacity
                style={styles.gearIconBtn}
                onPress={() =>
                  Alert.alert(
                    'Cài đặt Quản trị',
                    `Tài khoản Admin: ${user?.email}\nĐang quản trị ${accounts.length} tài khoản trên hệ thống.`
                  )
                }
                activeOpacity={0.7}
              >
                <Text style={styles.gearIconText}>⚙</Text>
              </TouchableOpacity>
            </View>

            {/* Segmented Control Role Picker */}
            <View style={styles.segmentedControl}>
              <TouchableOpacity
                style={[
                  styles.segmentBtn,
                  selectedRole === 'monitored_person' && styles.segmentBtnActive,
                ]}
                onPress={() => setSelectedRole('monitored_person')}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.segmentText,
                    selectedRole === 'monitored_person' && styles.segmentTextActive,
                  ]}
                >
                  Người được giám sát
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.segmentBtn,
                  selectedRole === 'supervisor' && styles.segmentBtnActive,
                ]}
                onPress={() => setSelectedRole('supervisor')}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.segmentText,
                    selectedRole === 'supervisor' && styles.segmentTextActive,
                  ]}
                >
                  Người giám sát
                </Text>
              </TouchableOpacity>
            </View>

            {/* 5 Input Fields */}
            <View style={styles.formGroup}>
              <TextInput
                style={styles.input}
                placeholder="Họ và tên"
                placeholderTextColor="#94A3B8"
                value={fullName}
                onChangeText={setFullName}
              />

              <TextInput
                style={styles.input}
                placeholder="Email đăng nhập"
                placeholderTextColor="#94A3B8"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <TextInput
                style={styles.input}
                placeholder="Mật khẩu tạm thời (tối thiểu 6 ký tự)"
                placeholderTextColor="#94A3B8"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={false}
                autoCapitalize="none"
              />

              <TextInput
                style={styles.input}
                placeholder="Số điện thoại (không bắt buộc)"
                placeholderTextColor="#94A3B8"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
              />

              <TextInput
                style={styles.input}
                placeholder="ID ESP, ví dụ ESP32_FALL_001"
                placeholderTextColor="#94A3B8"
                value={espId}
                onChangeText={setEspId}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>

            {/* Nút Tạo tài khoản */}
            <TouchableOpacity
              style={[styles.submitBtn, isCreating && { opacity: 0.7 }]}
              onPress={handleCreateAccount}
              disabled={isCreating}
              activeOpacity={0.85}
            >
              {isCreating ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.submitBtnText}>Tạo tài khoản</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* ── CARD 2: DANH SÁCH TÀI KHOẢN ── */}
          <View style={styles.cardContainer}>
            <Text style={styles.cardTitle}>Danh sách tài khoản</Text>

            {loadingAccounts ? (
              <View style={styles.loadingListWrap}>
                <ActivityIndicator size="small" color="#007AFF" />
                <Text style={styles.loadingListText}>Đang tải danh sách tài khoản...</Text>
              </View>
            ) : accounts.length === 0 ? (
              <Text style={styles.emptyListText}>Chưa có tài khoản nào trong hệ thống.</Text>
            ) : (
              <View style={styles.accountList}>
                {accounts.map((acc, index) => {
                  const isMonitored = acc.role === 'monitored_person';
                  const isLocked = acc.status === 'locked';
                  const initial = (acc.displayName || acc.email || 'N').charAt(0).toUpperCase();
                  const roleLabel =
                    acc.role === 'admin'
                      ? 'Quản trị viên'
                      : isMonitored
                      ? 'Người được giám sát'
                      : 'Người giám sát';

                  return (
                    <View
                      key={acc.email || index}
                      style={[
                        styles.accountItem,
                        index < accounts.length - 1 && styles.accountItemBorder,
                      ]}
                    >
                      {/* Avatar tròn với ký tự đầu */}
                      <View
                        style={[
                          styles.avatarCircle,
                          isMonitored ? styles.avatarMonitored : styles.avatarSupervisor,
                        ]}
                      >
                        <Text
                          style={[
                            styles.avatarText,
                            isMonitored ? styles.avatarTextMonitored : styles.avatarTextSupervisor,
                          ]}
                        >
                          {initial}
                        </Text>
                      </View>

                      {/* Thông tin tài khoản */}
                      <View style={styles.accountInfo}>
                        <Text style={styles.accountName} numberOfLines={1}>
                          {acc.displayName || acc.email}
                        </Text>
                        <Text style={styles.accountMeta} numberOfLines={1}>
                          {roleLabel} · {acc.email}
                        </Text>
                        {Boolean(acc.espId) && (
                          <Text style={styles.accountEsp}>ESP: {acc.espId}</Text>
                        )}
                      </View>

                      {/* Nút hành động Khóa / Mở */}
                      {acc.role !== 'admin' && !isAdminEmail(acc.email) && (
                        <TouchableOpacity
                          style={styles.actionBtn}
                          onPress={() => handleToggleLock(acc)}
                          disabled={processingEmail === acc.email}
                          activeOpacity={0.6}
                        >
                          {processingEmail === acc.email ? (
                            <ActivityIndicator size="small" color={isLocked ? '#10B981' : '#EF4444'} />
                          ) : (
                            <Text style={[styles.actionBtnText, isLocked ? styles.actionOpen : styles.actionLock]}>
                              {isLocked ? 'Mở' : 'Khóa'}
                            </Text>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* ── FOOTER ── */}
          <View style={styles.footer}>
            <Text style={styles.footerAdminTitle}>Quản trị viên</Text>
            <Text style={styles.footerAdminEmail}>
              Admin: {user?.email || 'ntuankiet0201@gmail.com'}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F8FD',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 44 : (StatusBar.currentHeight || 20) + 12,
    paddingBottom: 40,
  },

  /* ── Header ── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerLeft: {
    flex: 1,
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0088FF',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
  },
  logoutBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  logoutText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '700',
  },

  /* ── Stats Row ── */
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  statNumber: {
    fontSize: 34,
    fontWeight: '800',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },

  /* ── Card Container ── */
  cardContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  gearIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#94A3B8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearIconText: {
    color: '#FFFFFF',
    fontSize: 18,
  },

  /* ── Segmented Control ── */
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  segmentBtnActive: {
    backgroundColor: '#007AFF',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  segmentTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  /* ── Form Inputs ── */
  formGroup: {
    gap: 10,
    marginBottom: 16,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 14,
    fontSize: 14,
    color: '#0F172A',
  },

  /* ── Submit Button ── */
  submitBtn: {
    backgroundColor: '#007AFF',
    borderRadius: 14,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },

  /* ── Account List ── */
  loadingListWrap: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  loadingListText: {
    marginTop: 8,
    fontSize: 13,
    color: '#64748B',
  },
  emptyListText: {
    textAlign: 'center',
    color: '#94A3B8',
    fontSize: 14,
    paddingVertical: 16,
  },
  accountList: {
    marginTop: 8,
  },
  accountItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  accountItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarMonitored: {
    backgroundColor: '#FEE2E2',
  },
  avatarSupervisor: {
    backgroundColor: '#DBEAFE',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '800',
  },
  avatarTextMonitored: {
    color: '#EF4444',
  },
  avatarTextSupervisor: {
    color: '#2563EB',
  },
  accountInfo: {
    flex: 1,
    marginRight: 10,
  },
  accountName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2,
  },
  accountMeta: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 1,
  },
  accountEsp: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  actionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  actionOpen: {
    color: '#10B981',
  },
  actionLock: {
    color: '#EF4444',
  },

  /* ── Footer ── */
  footer: {
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  footerAdminTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  footerAdminEmail: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
});
