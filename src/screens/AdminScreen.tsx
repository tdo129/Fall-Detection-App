import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  Modal,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useAuth } from '../context/AuthContext';
import {
  UserProfile,
  UserRole,
  AccountStatus,
  subscribeToAllUsers,
  createAccountByAdmin,
  resendActivationCode,
  toggleAccountStatus,
  deleteAccountByAdmin,
  approveRegistrationRequest,
  rejectRegistrationRequest,
  updateUserRoleByAdmin,
  isAdminEmail,
  validateGoogleEmail,
} from '../services/authService';
import {
  getMailConfig,
  saveMailConfig,
  testSendEmail,
  MailConfig,
} from '../services/mailService';

export default function AdminScreen() {
  const { user, logout } = useAuth();

  // State quản lý form tạo tài khoản (chỉ giữ lại Họ tên, Email, Số điện thoại)
  const [selectedRole, setSelectedRole] = useState<UserRole>('monitored_person');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Tab lọc danh sách tài khoản: 'monitored_person' hoặc 'supervisor'
  const [listRoleTab, setListRoleTab] = useState<UserRole>('monitored_person');

  // State danh sách tài khoản
  const [accounts, setAccounts] = useState<UserProfile[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [processingEmail, setProcessingEmail] = useState<string | null>(null);

  // State xem mã dự phòng (mặc định ẩn để người dùng tự xem trong hòm thư Gmail)
  const [revealedCodes, setRevealedCodes] = useState<Record<string, boolean>>({});
  const toggleRevealCode = (userEmail: string) => {
    setRevealedCodes((prev) => ({
      ...prev,
      [userEmail]: !prev[userEmail],
    }));
  };

  // State cấu hình gửi mail tự động qua Google Apps Script Web App
  const [mailConfigModalVisible, setMailConfigModalVisible] = useState(false);
  const [currentMailConfig, setCurrentMailConfig] = useState<MailConfig>({});
  const [gasUrlInput, setGasUrlInput] = useState('');
  const [testEmailInput, setTestEmailInput] = useState('');
  const [isTestingMail, setIsTestingMail] = useState(false);
  const [isSavingMailConfig, setIsSavingMailConfig] = useState(false);

  // Tải cấu hình gửi mail khi mở màn hình Quản trị viên
  useEffect(() => {
    getMailConfig().then((cfg) => {
      setCurrentMailConfig(cfg);
      if (cfg.gasUrl) setGasUrlInput(cfg.gasUrl);
    });
    if (user?.email) {
      setTestEmailInput(user.email);
    }
  }, [user]);

  // Lắng nghe real-time danh sách tài khoản Firestore
  useEffect(() => {
    const unsubscribe = subscribeToAllUsers((list) => {
      setAccounts(list);
      setLoadingAccounts(false);
    });
    return () => unsubscribe();
  }, []);

  // Danh sách yêu cầu đăng ký chờ duyệt
  const pendingApprovalAccounts = accounts.filter((a) => a.status === 'pending_approval');
  const pendingApprovalCount = pendingApprovalAccounts.length;

  // Tính số lượng thống kê theo vai trò (chỉ tính tài khoản đã duyệt: active, pending, locked)
  const approvedAccounts = accounts.filter((a) => a.status !== 'pending_approval');
  const supervisorCount = approvedAccounts.filter((a) => a.role === 'supervisor').length;
  const monitoredCount = approvedAccounts.filter((a) => a.role === 'monitored_person').length;

  // Lọc danh sách tài khoản theo tab được chọn (loại trừ pending_approval vì có khu vực duyệt riêng)
  const filteredAccounts = approvedAccounts.filter((acc) => {
    if (listRoleTab === 'monitored_person') {
      return acc.role === 'monitored_person';
    }
    // supervisor tab: hiển thị supervisor và admin
    return acc.role === 'supervisor' || acc.role === 'admin' || isAdminEmail(acc.email);
  });

  // State xác minh tài khoản Gmail có tồn tại trên Google hay không
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyingEmail, setVerifyingEmail] = useState('');
  const [verifyKey, setVerifyKey] = useState(0);
  const verifyTimeoutRef = useRef<any>(null);
  const isResolvingRef = useRef(false);

  const chromeUserAgent =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

  // Injected JS tự động nhập email trên cổng accounts.google.com và kiểm tra xem tài khoản có thật hay không
  const injectedVerifierScript = useMemo(() => {
    if (!verifyingEmail) return '';
    return `
      (function() {
        var target = ${JSON.stringify(verifyingEmail)};
        var done = false;
        var checks = 0;
        
        var timer = setInterval(function() {
          checks++;
          var body = (document.body && (document.body.innerText || document.body.textContent)) ? (document.body.innerText || document.body.textContent) : '';
          
          if (checks % 4 === 0) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'WV_LOG',
              msg: 'Check #' + checks + ' | url=' + window.location.href + ' | notFound=' + (body.indexOf('Không tìm thấy') !== -1)
            }));
          }

          // 1. Google thông báo không tìm thấy tài khoản (Gmail không tồn tại)
          if (
            body.indexOf('Không tìm thấy') !== -1 ||
            body.indexOf('Không thể tìm thấy') !== -1 ||
            body.indexOf("Couldn't find") !== -1 ||
            body.indexOf('Could not find') !== -1 ||
            body.indexOf('Nhập email hoặc số điện thoại hợp lệ') !== -1 ||
            body.indexOf('Enter a valid email') !== -1
          ) {
            clearInterval(timer);
            done = true;
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'VERIFY_RESULT',
              exists: false,
              message: 'Không tìm thấy Gmail này'
            }));
            return;
          }
          
          // 2. Tài khoản CÓ TỒN TẠI TRÊN GOOGLE (chuyển sang bước nhập mật khẩu thực sự, chào mừng hoặc xác minh)
          var realPassInput = document.querySelector('input[name="Passwd"]') ||
                              document.querySelector('input[type="password"]:not([name="hiddenPassword"])') ||
                              document.querySelector('input[autocomplete="current-password"]');
          var heading = document.querySelector('h1, #headingText');
          var headingText = heading ? (heading.innerText || heading.textContent || '') : '';
          if (
            realPassInput ||
            headingText.indexOf('Chào mừng') !== -1 ||
            headingText.indexOf('Welcome') !== -1 ||
            headingText.indexOf('Nhập mật khẩu') !== -1 ||
            headingText.indexOf('Enter your password') !== -1
          ) {
            clearInterval(timer);
            done = true;
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'VERIFY_RESULT',
              exists: true
            }));
            return;
          }
          
          // 3. Nếu đang ở màn hình chọn tài khoản, bấm "Sử dụng một tài khoản khác"
          var useAnother = Array.from(document.querySelectorAll('div, li, [role="link"], span')).find(function(el) {
            var txt = el.innerText || el.textContent || '';
            return txt.indexOf('Sử dụng một tài khoản khác') !== -1 || txt.indexOf('Use another account') !== -1;
          });
          if (useAnother && !realPassInput && !document.querySelector('input[name="identifier"]')) {
            useAnother.click();
            return;
          }
          
          // 4. Tìm ô nhập email và bấm nút Tiếp theo
          var input = document.querySelector('#identifierId') || 
                      document.querySelector('input[name="identifier"]') ||
                      document.querySelector('input[type="email"]') ||
                      document.querySelector('input[type="text"]');
          if (input && !input.dataset.tested) {
            input.dataset.tested = 'true';
            input.focus();
            try {
              var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              if (nativeSetter) {
                nativeSetter.call(input, target);
              } else {
                input.value = target;
              }
            } catch (err) {
              input.value = target;
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            
            setTimeout(function() {
              var btn = document.querySelector('#identifierNext button') || 
                        document.querySelector('#identifierNext') || 
                        document.querySelector('button[type="button"]') ||
                        document.querySelector('button');
              if (btn) {
                btn.click();
              }
              try {
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
              } catch (e) {}
            }, 350);
          }
          
          // 5. Sau 40 chu kỳ (~12 giây) nếu không tìm thấy mật khẩu -> báo không tìm thấy
          if (checks > 40 && !done) {
            clearInterval(timer);
            done = true;
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'VERIFY_RESULT',
              exists: false,
              message: 'Không tìm thấy Gmail này'
            }));
          }
        }, 300);
      })();
      true;
    `;
  }, [verifyingEmail, verifyKey]);

  // Xử lý kết quả kiểm tra sự tồn tại của Gmail từ máy chủ Google
  const handleVerifyMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'WV_LOG') {
        console.log('[WV_DEBUG]', data.msg);
        return;
      }
      if (data.type !== 'VERIFY_RESULT') return;
      if (isResolvingRef.current) return;
      isResolvingRef.current = true;

      if (verifyTimeoutRef.current) {
        clearTimeout(verifyTimeoutRef.current);
        verifyTimeoutRef.current = null;
      }

      setIsVerifying(false);

      if (!data.exists) {
        // Thông báo chính xác theo yêu cầu: không tìm thấy Gmail này
        Alert.alert(
          'Không tìm thấy Gmail này',
          `Không tìm thấy tài khoản Gmail [${verifyingEmail}] trên hệ thống Google.\n\nVui lòng kiểm tra lại chính xác địa chỉ email và đảm bảo tài khoản đã được đăng ký trên Google.`
        );
        return;
      }

      // Tài khoản CÓ THẬT trên Google -> Thêm vào hệ thống CareDrop
      await performAccountCreation(verifyingEmail);
    } catch (e) {
      console.warn('Verify message error:', e);
    }
  };

  // Thực hiện thêm tài khoản vào Firestore và gửi email kích hoạt
  const performAccountCreation = async (targetEmail: string) => {
    setIsCreating(true);
    try {
      const res = await createAccountByAdmin({
        displayName: fullName.trim(),
        email: targetEmail,
        phoneNumber: phone.trim(),
        role: selectedRole,
      });

      const roleLabel =
        selectedRole === 'monitored_person' ? 'Người được giám sát' : 'Người giám sát';

      Alert.alert(
        'Thêm tài khoản thành công! ✉️',
        `Đã thêm tài khoản [${targetEmail}] (${roleLabel}).\n\nMã kích hoạt đã được gửi trực tiếp về hòm thư Gmail của người dùng.\n\nNgười dùng vui lòng mở ứng dụng Gmail (Hộp thư đến / Spam) để lấy mã và tự đăng nhập vào CareDrop.`
      );

      // Reset form
      setFullName('');
      setEmail('');
      setPhone('');
    } catch (err: any) {
      Alert.alert('Lỗi tạo tài khoản', err.message || 'Không thể tạo tài khoản trên hệ thống.');
    } finally {
      setIsCreating(false);
      setVerifyingEmail('');
    }
  };

  // Xử lý tạo tài khoản mới: Xác thực format -> Check trùng -> Kiểm tra tồn tại trên Google -> Thêm tài khoản
  const handleCreateAccount = async () => {
    if (!fullName.trim()) {
      Alert.alert('Chưa nhập thông tin', 'Vui lòng nhập Họ và tên.');
      return;
    }
    const cleanMail = email.trim().toLowerCase();
    const validation = validateGoogleEmail(cleanMail);
    if (!validation.isValid) {
      Alert.alert(
        'Gmail không hợp lệ ⚠️',
        validation.error || 'Vui lòng nhập đúng định dạng Gmail có thật trên Google (@gmail.com).'
      );
      return;
    }

    // Kiểm tra trùng lặp trong hệ thống CareDrop
    const alreadyExists = accounts.some((a) => a.email.toLowerCase() === cleanMail);
    if (alreadyExists) {
      Alert.alert(
        'Tài khoản đã tồn tại ⚠️',
        `Tài khoản [${cleanMail}] đã có trong hệ thống CareDrop.`
      );
      return;
    }

    // Bắt đầu kiểm tra xem Gmail có tồn tại thật trên Google hay không
    isResolvingRef.current = false;
    setVerifyingEmail(cleanMail);
    setVerifyKey((prev) => prev + 1);
    setIsVerifying(true);

    // Timeout bảo vệ 14 giây: Nếu không xác nhận được thì từ chối thêm và báo không tìm thấy
    if (verifyTimeoutRef.current) clearTimeout(verifyTimeoutRef.current);
    verifyTimeoutRef.current = setTimeout(() => {
      if (!isResolvingRef.current) {
        isResolvingRef.current = true;
        setIsVerifying(false);
        Alert.alert(
          'Không tìm thấy Gmail này',
          `Không tìm thấy tài khoản Gmail [${cleanMail}] trên hệ thống Google.\n\nVui lòng kiểm tra lại chính xác địa chỉ email và đảm bảo tài khoản đã được đăng ký trên Google.`
        );
      }
    }, 14000);
  };

  // Gửi lại mã kích hoạt trực tiếp về hòm thư Gmail của người dùng
  const handleResendCode = async (targetUser: UserProfile) => {
    setProcessingEmail(targetUser.email);
    try {
      await resendActivationCode(
        targetUser.email,
        targetUser.displayName,
        targetUser.role
      );
      Alert.alert(
        'Đã gửi lại email kích hoạt ✉️',
        `Mã kích hoạt mới đã được gửi về hòm thư Gmail [${targetUser.email}].\n\nNgười dùng vui lòng mở ứng dụng Gmail (Hộp thư đến / Spam) để lấy mã.`
      );
    } catch (e: any) {
      Alert.alert('Lỗi', e.message || 'Không thể gửi lại mã kích hoạt.');
    } finally {
      setProcessingEmail(null);
    }
  };

  // Lưu cấu hình Google Apps Script URL vào Firestore
  const handleSaveMailConfig = async () => {
    setIsSavingMailConfig(true);
    try {
      await saveMailConfig({ gasUrl: gasUrlInput.trim() });
      const updated = await getMailConfig();
      setCurrentMailConfig(updated);
      Alert.alert('Thành công 🎉', 'Đã lưu cấu hình gửi email thành công vào hệ thống!');
      setMailConfigModalVisible(false);
    } catch (e: any) {
      Alert.alert('Lỗi lưu cấu hình', e?.message || 'Không thể lưu cấu hình gửi mail.');
    } finally {
      setIsSavingMailConfig(false);
    }
  };

  // Kiểm tra thử nghiệm gửi email vào Gmail của Admin
  const handleTestSendMail = async () => {
    const target = testEmailInput.trim().toLowerCase();
    if (!target || !target.includes('@')) {
      Alert.alert('Chưa nhập email', 'Vui lòng nhập địa chỉ Gmail để nhận thử email kích hoạt.');
      return;
    }
    setIsTestingMail(true);
    try {
      if (gasUrlInput.trim() !== currentMailConfig.gasUrl) {
        await saveMailConfig({ gasUrl: gasUrlInput.trim() });
        const updated = await getMailConfig();
        setCurrentMailConfig(updated);
      }
      const res = await testSendEmail(target);
      if (res.success) {
        Alert.alert(
          'Gửi thử thành công! ✉️',
          `Hệ thống đã gửi email chứa mã kích hoạt mẫu tới [${target}].\n\nVui lòng mở ứng dụng Gmail (Hộp thư đến / Thư rác) để kiểm tra!`
        );
      } else {
        Alert.alert(
          'Chưa gửi được vào Hòm thư ⚠️',
          `Chưa thể gửi email tới [${target}].\n\n${res.message || 'Vui lòng kiểm tra lại URL Google Apps Script đã chọn quyền Anyone (Bất kỳ ai) hay chưa.'}`
        );
      }
    } catch (e: any) {
      Alert.alert('Lỗi gửi thử', e?.message || 'Có lỗi xảy ra khi kiểm tra gửi thư.');
    } finally {
      setIsTestingMail(false);
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
      Alert.alert('Không thể thực hiện', 'Bạn không thể khóa tài khoản Quản trị viên.');
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
                targetUser.status || 'active',
                targetUser.docId
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

  // Xử lý Xóa vĩnh viễn tài khoản khỏi hệ thống
  const handleDeleteAccount = (targetUser: UserProfile) => {
    // Không cho phép tự xóa chính mình hoặc xóa tài khoản Quản trị viên
    if (
      targetUser.email.toLowerCase() === user?.email.toLowerCase() ||
      isAdminEmail(targetUser.email)
    ) {
      Alert.alert('Không thể thực hiện', 'Bạn không thể xóa tài khoản Quản trị viên.');
      return;
    }

    const roleName = targetUser.role === 'monitored_person' ? 'Người được giám sát' : 'Người giám sát';

    Alert.alert(
      'Xác nhận xóa tài khoản 🗑️',
      `Bạn có chắc chắn muốn xóa vĩnh viễn tài khoản [${targetUser.email}] (${roleName}) khỏi hệ thống không?\n\nNgười dùng này sẽ không thể đăng nhập vào ứng dụng nữa.`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa vĩnh viễn',
          style: 'destructive',
          onPress: async () => {
            setProcessingEmail(targetUser.email);
            try {
              await deleteAccountByAdmin(targetUser.email, targetUser.docId);
              Alert.alert('Thành công', `Đã xóa tài khoản [${targetUser.email}] khỏi hệ thống.`);
            } catch (e: any) {
              Alert.alert('Lỗi', e.message || 'Không thể xóa tài khoản khỏi hệ thống.');
            } finally {
              setProcessingEmail(null);
            }
          },
        },
      ]
    );
  };

  // Quản trị viên duyệt yêu cầu đăng ký của người dùng
  const handleApproveRequest = (targetUser: UserProfile) => {
    const roleLabel =
      targetUser.role === 'monitored_person' ? 'Người được giám sát' : 'Người giám sát';

    Alert.alert(
      'XÁC NHẬN DUYỆT ĐĂNG KÝ',
      `Bạn có đồng ý phê duyệt tài khoản Gmail [${targetUser.email}] với phân quyền "${roleLabel}" không?\n\nSau khi duyệt, hệ thống sẽ tự động tạo mã xác nhận 6 số và gửi thư tới Gmail của người dùng.`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Duyệt & Gửi mã',
          style: 'default',
          onPress: async () => {
            setProcessingEmail(targetUser.email);
            try {
              const code = await approveRegistrationRequest(targetUser.email, targetUser.docId);
              Alert.alert(
                'Phê duyệt thành công! ✉️',
                `Đã duyệt tài khoản [${targetUser.email}] (${roleLabel}).\n\nMã kích hoạt [${code}] đã được gửi về hộp thư Gmail của người dùng. Người dùng có thể nhập mã để bắt đầu sử dụng app.`
              );
            } catch (e: any) {
              Alert.alert('Lỗi phê duyệt', e?.message || 'Không thể phê duyệt yêu cầu.');
            } finally {
              setProcessingEmail(null);
            }
          },
        },
      ]
    );
  };

  // Quản trị viên từ chối yêu cầu đăng ký
  const handleRejectRequest = (targetUser: UserProfile) => {
    Alert.alert(
      'XÁC NHẬN TỪ CHỐI',
      `Bạn có chắc chắn muốn từ chối yêu cầu đăng ký của [${targetUser.email}] không?\n\nYêu cầu đăng ký này sẽ bị xóa khỏi hệ thống.`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Từ chối & Xóa',
          style: 'destructive',
          onPress: async () => {
            setProcessingEmail(targetUser.email);
            try {
              await rejectRegistrationRequest(targetUser.email, targetUser.docId);
              Alert.alert('Đã từ chối', `Đã xóa yêu cầu đăng ký của [${targetUser.email}].`);
            } catch (e: any) {
              Alert.alert('Lỗi', e?.message || 'Không thể xóa yêu cầu.');
            } finally {
              setProcessingEmail(null);
            }
          },
        },
      ]
    );
  };

  // Quản trị viên thay đổi phân quyền tài khoản (theo yêu cầu của người dùng)
  const handleChangeRole = (targetUser: UserProfile) => {
    if (isAdminEmail(targetUser.email) || targetUser.role === 'admin') {
      Alert.alert('Không thể thay đổi', 'Không thể thay đổi vai trò của Quản trị viên.');
      return;
    }

    const currentRole = targetUser.role === 'monitored_person' ? 'monitored_person' : 'supervisor';
    const newRole: UserRole = currentRole === 'monitored_person' ? 'supervisor' : 'monitored_person';
    const currentRoleName = currentRole === 'monitored_person' ? 'Người được giám sát' : 'Người giám sát';
    const newRoleName = newRole === 'monitored_person' ? 'Người được giám sát' : 'Người giám sát';

    Alert.alert(
      'ĐỔI PHÂN QUYỀN TÀI KHOẢN',
      `Tài khoản: ${targetUser.email}\n• Phân quyền hiện tại: ${currentRoleName}\n• Phân quyền mới: ${newRoleName}\n\nBạn có muốn chuyển đổi phân quyền cho tài khoản này không?`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: `Đổi sang "${newRoleName}"`,
          onPress: async () => {
            setProcessingEmail(targetUser.email);
            try {
              await updateUserRoleByAdmin(targetUser.email, newRole, targetUser.docId);
              Alert.alert(
                'Đổi phân quyền thành công! 🎉',
                `Tài khoản [${targetUser.email}] đã được chuyển đổi sang phân quyền "${newRoleName}".`
              );
            } catch (e: any) {
              Alert.alert('Lỗi', e?.message || 'Không thể đổi phân quyền tài khoản.');
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

            {/* Card 3: Yêu cầu chờ duyệt */}
            <View style={styles.statCard}>
              <Text style={[styles.statNumber, { color: pendingApprovalCount > 0 ? '#F59E0B' : '#94A3B8' }]}>
                {pendingApprovalCount}
              </Text>
              <Text style={styles.statLabel}>Chờ duyệt</Text>
            </View>
          </View>

          {/* ── CARD: YÊU CẦU ĐĂNG KÝ CHỜ DUYỆT ── */}
          <View style={styles.cardContainer}>
            <View style={styles.cardHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.cardTitle}>Yêu cầu đăng ký chờ duyệt</Text>
                {pendingApprovalCount > 0 && (
                  <View style={styles.pendingBadgeCount}>
                    <Text style={styles.pendingBadgeCountText}>{pendingApprovalCount} mới</Text>
                  </View>
                )}
              </View>
            </View>

            {pendingApprovalCount === 0 ? (
              <View style={styles.emptyPendingBox}>
                <Text style={styles.emptyPendingText}>
                  ✓ Hiện không có yêu cầu đăng ký nào đang chờ duyệt.
                </Text>
              </View>
            ) : (
              <View style={styles.pendingList}>
                {pendingApprovalAccounts.map((req, idx) => {
                  const reqRoleLabel =
                    req.role === 'monitored_person' ? 'Người được giám sát' : 'Người giám sát';
                  const reqRoleColor = req.role === 'monitored_person' ? '#10B981' : '#007AFF';
                  const reqInitial = (req.displayName || req.email || 'N').charAt(0).toUpperCase();

                  return (
                    <View
                      key={req.email || idx}
                      style={[
                        styles.pendingCardItem,
                        idx < pendingApprovalAccounts.length - 1 && styles.pendingCardItemBorder,
                      ]}
                    >
                      <View style={styles.pendingCardTopRow}>
                        <View
                          style={[
                            styles.avatarCircle,
                            {
                              backgroundColor:
                                req.role === 'monitored_person'
                                  ? 'rgba(16, 185, 129, 0.15)'
                                  : 'rgba(0, 122, 255, 0.15)',
                            },
                          ]}
                        >
                          <Text style={[styles.avatarText, { color: reqRoleColor }]}>
                            {reqInitial}
                          </Text>
                        </View>

                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={styles.pendingCardName}>
                            {req.displayName || req.email}
                          </Text>
                          <Text style={styles.pendingCardEmail}>{req.email}</Text>
                          {Boolean(req.phoneNumber) && (
                            <Text style={styles.pendingCardPhone}>SĐT: {req.phoneNumber}</Text>
                          )}
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                            <View
                              style={[
                                styles.pendingRolePill,
                                {
                                  backgroundColor:
                                    req.role === 'monitored_person'
                                      ? 'rgba(16, 185, 129, 0.15)'
                                      : 'rgba(0, 122, 255, 0.15)',
                                  borderColor:
                                    req.role === 'monitored_person'
                                      ? 'rgba(16, 185, 129, 0.3)'
                                      : 'rgba(0, 122, 255, 0.3)',
                                },
                              ]}
                            >
                              <Text style={[styles.pendingRolePillText, { color: reqRoleColor }]}>
                                {req.role === 'monitored_person' ? '🛡️ ' : '👁️ '}
                                {reqRoleLabel}
                              </Text>
                            </View>
                          </View>
                        </View>
                      </View>

                      {/* Action buttons: Duyệt & Gửi mã vs Từ chối */}
                      <View style={styles.pendingActionRow}>
                        <TouchableOpacity
                          style={[
                            styles.pendingApproveBtn,
                            processingEmail === req.email && { opacity: 0.7 },
                          ]}
                          onPress={() => handleApproveRequest(req)}
                          disabled={processingEmail === req.email}
                          activeOpacity={0.8}
                        >
                          {processingEmail === req.email ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                          ) : (
                            <Text style={styles.pendingApproveText}>✓ Duyệt & Gửi mã Gmail</Text>
                          )}
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.pendingRejectBtn,
                            processingEmail === req.email && { opacity: 0.7 },
                          ]}
                          onPress={() => handleRejectRequest(req)}
                          disabled={processingEmail === req.email}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.pendingRejectText}>✕ Từ chối</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* ── CARD 1: TẠO TÀI KHOẢN MỚI ── */}
          <View style={styles.cardContainer}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>Tạo tài khoản mới</Text>
              <TouchableOpacity
                style={styles.gearIconBtn}
                onPress={() => setMailConfigModalVisible(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.gearIconText}>⚙</Text>
              </TouchableOpacity>
            </View>

            {/* Thanh trạng thái gửi mail tự động vào Gmail */}
            <TouchableOpacity
              style={styles.mailStatusBanner}
              onPress={() => setMailConfigModalVisible(true)}
              activeOpacity={0.8}
            >
              <View
                style={[
                  styles.mailStatusDot,
                  { backgroundColor: currentMailConfig.gasUrl ? '#10B981' : '#F59E0B' },
                ]}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.mailStatusTitle}>
                  {currentMailConfig.gasUrl
                    ? '✉️ Gửi mã vào Gmail: Đã kích hoạt'
                    : '✉️ Gửi mã vào Gmail: Cần cấu hình'}
                </Text>
                <Text style={styles.mailStatusSubtitle}>
                  {currentMailConfig.gasUrl
                    ? 'Mã kích hoạt sẽ gửi trực tiếp về Hòm thư Gmail của người dùng'
                    : 'Bấm vào đây để cấu hình gửi mã tự động vào Hòm thư'}
                </Text>
              </View>
              <Text style={styles.mailStatusBtnText}>Cài đặt ⚙️</Text>
            </TouchableOpacity>

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

            {/* 3 Input Fields: Họ và tên, Email, Số điện thoại */}
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
                placeholder="Email đăng nhập (Gmail)"
                placeholderTextColor="#94A3B8"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />



              <TextInput
                style={styles.input}
                placeholder="Số điện thoại (không bắt buộc)"
                placeholderTextColor="#94A3B8"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
              />
            </View>

            {/* Nút Thêm tài khoản */}
            <TouchableOpacity
              style={[styles.submitBtn, isCreating && { opacity: 0.7 }]}
              onPress={handleCreateAccount}
              disabled={isCreating}
              activeOpacity={0.85}
            >
              {isCreating ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.submitBtnText}>Thêm tài khoản & Gửi mã</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* ── CARD 2: DANH SÁCH TÀI KHOẢN ── */}
          <View style={styles.cardContainer}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>Danh sách tài khoản</Text>
              <View style={styles.totalCountBadge}>
                <Text style={styles.totalCountText}>{accounts.length} tài khoản</Text>
              </View>
            </View>

            {/* Segmented Control chia 2 mục: Người được giám sát & Người giám sát */}
            <View style={styles.segmentedControl}>
              <TouchableOpacity
                style={[
                  styles.segmentBtn,
                  listRoleTab === 'monitored_person' && styles.segmentBtnActive,
                ]}
                onPress={() => setListRoleTab('monitored_person')}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.segmentText,
                    listRoleTab === 'monitored_person' && styles.segmentTextActive,
                  ]}
                >
                  Người được giám sát ({monitoredCount})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.segmentBtn,
                  listRoleTab === 'supervisor' && styles.segmentBtnActive,
                ]}
                onPress={() => setListRoleTab('supervisor')}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.segmentText,
                    listRoleTab === 'supervisor' && styles.segmentTextActive,
                  ]}
                >
                  Người giám sát ({supervisorCount})
                </Text>
              </TouchableOpacity>
            </View>

            {loadingAccounts ? (
              <View style={styles.loadingListWrap}>
                <ActivityIndicator size="small" color="#007AFF" />
                <Text style={styles.loadingListText}>Đang tải danh sách tài khoản...</Text>
              </View>
            ) : filteredAccounts.length === 0 ? (
              <Text style={styles.emptyListText}>
                Chưa có tài khoản {listRoleTab === 'monitored_person' ? 'Người được giám sát' : 'Người giám sát'} nào.
              </Text>
            ) : (
              <View style={styles.accountList}>
                {filteredAccounts.map((acc, index) => {
                  const isMonitored = acc.role === 'monitored_person';
                  const isLocked = acc.status === 'locked';
                  const isPending = acc.status === 'pending';
                  const isTargetAdmin = acc.role === 'admin' || isAdminEmail(acc.email);
                  const initial = (acc.displayName || acc.email || 'N').charAt(0).toUpperCase();
                  const roleLabel = isTargetAdmin
                    ? 'Quản trị viên'
                    : isMonitored
                    ? 'Người được giám sát'
                    : 'Người giám sát';

                  return (
                    <View
                      key={acc.email || index}
                      style={[
                        styles.accountItem,
                        index < filteredAccounts.length - 1 && styles.accountItemBorder,
                      ]}
                    >
                      {/* Dòng trên: Avatar + Toàn bộ thông tin tài khoản */}
                      <View style={styles.accountTopRow}>
                        {/* Avatar tròn với ký tự đầu */}
                        <View
                          style={[
                            styles.avatarCircle,
                            isTargetAdmin
                              ? styles.avatarAdmin
                              : isMonitored
                              ? styles.avatarMonitored
                              : styles.avatarSupervisor,
                          ]}
                        >
                          <Text
                            style={[
                              styles.avatarText,
                              isTargetAdmin
                                ? styles.avatarTextAdmin
                                : isMonitored
                                ? styles.avatarTextMonitored
                                : styles.avatarTextSupervisor,
                            ]}
                          >
                            {initial}
                          </Text>
                        </View>

                        {/* Thông tin tài khoản chi tiết */}
                        <View style={styles.accountInfo}>
                          {/* Tên hiển thị + Badge trạng thái */}
                          <View style={styles.accountNameRow}>
                            <Text style={styles.accountName}>
                              {acc.displayName || acc.email}
                            </Text>
                            {isLocked ? (
                              <View style={styles.lockedPill}>
                                <Text style={styles.lockedPillText}>Đã khóa</Text>
                              </View>
                            ) : isPending ? (
                              <View style={styles.pendingPill}>
                                <Text style={styles.pendingPillText}>Chờ kích hoạt</Text>
                              </View>
                            ) : null}
                          </View>

                          {/* Gmail hiển thị đầy đủ trên dòng riêng */}
                          <Text style={styles.accountEmailText} selectable>
                            {acc.email}
                          </Text>

                          {/* Phân quyền, SĐT, ESP */}
                          <View style={styles.accountMetaRow}>
                            <View
                              style={[
                                styles.accountRolePill,
                                isMonitored
                                  ? styles.accountRolePillMonitored
                                  : styles.accountRolePillSupervisor,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.accountRolePillText,
                                  isMonitored
                                    ? styles.accountRolePillTextMonitored
                                    : styles.accountRolePillTextSupervisor,
                                ]}
                              >
                                {isMonitored ? '🛡️ Người được giám sát' : '👁️ Người giám sát'}
                              </Text>
                            </View>

                            {Boolean(acc.phoneNumber) && (
                              <Text style={styles.accountMetaSub}>📞 {acc.phoneNumber}</Text>
                            )}
                            {Boolean(acc.espId) && (
                              <Text style={styles.accountMetaSub}>📟 ESP: {acc.espId}</Text>
                            )}
                          </View>

                          {/* Hộp mã kích hoạt Gmail nếu đang chờ kích hoạt */}
                          {isPending && (
                            <View style={styles.pendingCodeBox}>
                              <View style={styles.pendingCodeHeaderRow}>
                                <Text style={styles.pendingCodeStatusText}>
                                  ✉️ Đã gửi mã về Gmail
                                </Text>
                                {revealedCodes[acc.email] ? (
                                  <TouchableOpacity
                                    onPress={() => toggleRevealCode(acc.email)}
                                    activeOpacity={0.7}
                                  >
                                    <Text style={styles.revealedCodeText}>
                                      Mã: {acc.activationCode}
                                    </Text>
                                  </TouchableOpacity>
                                ) : (
                                  <TouchableOpacity
                                    onPress={() => toggleRevealCode(acc.email)}
                                    activeOpacity={0.7}
                                  >
                                    <Text style={styles.revealCodeBtnText}>
                                      [Mã dự phòng]
                                    </Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            </View>
                          )}
                        </View>
                      </View>

                      {/* Dòng dưới: Nhóm nút hành động Khóa/Mở, Đổi quyền, Xóa, Gửi lại */}
                      {isTargetAdmin ? (
                        <View style={styles.adminBadgeRow}>
                          <Text style={styles.adminBadgeRowText}>🛡️ Quản trị viên hệ thống (Không thể thao tác)</Text>
                        </View>
                      ) : (
                        <View style={styles.accountActionRow}>
                          {isPending ? (
                            /* Nút Gửi lại mã cho tài khoản đang chờ kích hoạt */
                            <TouchableOpacity
                              style={[styles.actionBtn, styles.actionBtnResend]}
                              onPress={() => handleResendCode(acc)}
                              disabled={processingEmail === acc.email}
                              activeOpacity={0.7}
                            >
                              {processingEmail === acc.email ? (
                                <ActivityIndicator size="small" color="#007AFF" />
                              ) : (
                                <Text style={styles.actionResendText}>✉️ Gửi lại</Text>
                              )}
                            </TouchableOpacity>
                          ) : (
                            /* Nút Khóa / Mở cho tài khoản đã kích hoạt */
                            <TouchableOpacity
                              style={[
                                styles.actionBtn,
                                isLocked ? styles.actionBtnOpen : styles.actionBtnLock,
                              ]}
                              onPress={() => handleToggleLock(acc)}
                              disabled={processingEmail === acc.email}
                              activeOpacity={0.7}
                            >
                              {processingEmail === acc.email ? (
                                <ActivityIndicator
                                  size="small"
                                  color={isLocked ? '#10B981' : '#EF4444'}
                                />
                              ) : (
                                <Text
                                  style={[
                                    styles.actionBtnText,
                                    isLocked ? styles.actionOpenText : styles.actionLockText,
                                  ]}
                                >
                                  {isLocked ? '🔓 Mở khóa' : '🔒 Khóa'}
                                </Text>
                              )}
                            </TouchableOpacity>
                          )}

                          {/* Nút Đổi phân quyền */}
                          <TouchableOpacity
                            style={[styles.actionBtn, styles.actionBtnRole]}
                            onPress={() => handleChangeRole(acc)}
                            disabled={processingEmail === acc.email}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.actionRoleText}>🔄 Đổi quyền</Text>
                          </TouchableOpacity>

                          {/* Nút Xóa */}
                          <TouchableOpacity
                            style={[styles.actionBtn, styles.actionBtnDelete]}
                            onPress={() => handleDeleteAccount(acc)}
                            disabled={processingEmail === acc.email}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.actionDeleteText}>🗑️ Xóa</Text>
                          </TouchableOpacity>
                        </View>
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

      {/* Modal hiển thị khi đang xác minh Gmail trên Google */}
      <Modal visible={isVerifying} transparent animationType="fade">
        <View style={styles.verifyingOverlay}>
          <View style={styles.verifyingCard}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.verifyingTitle}>Đang kiểm tra tài khoản trên Google...</Text>
            <Text style={styles.verifyingEmail}>{verifyingEmail}</Text>
            <Text style={styles.verifyingSubtitle}>Xác thực sự tồn tại của hộp thư Gmail</Text>
            
            <TouchableOpacity
              style={styles.cancelVerifyBtn}
              onPress={() => {
                if (verifyTimeoutRef.current) {
                  clearTimeout(verifyTimeoutRef.current);
                  verifyTimeoutRef.current = null;
                }
                isResolvingRef.current = true;
                setIsVerifying(false);
                setVerifyingEmail('');
              }}
            >
              <Text style={styles.cancelVerifyBtnText}>Hủy</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* WebView ẩn để kiểm tra sự tồn tại của Gmail trên accounts.google.com */}
      {isVerifying && verifyingEmail ? (
        <View style={styles.hiddenWebViewContainer} pointerEvents="none">
          <WebView
            key={`verify-${verifyKey}-${verifyingEmail}`}
            source={{
              uri: 'https://accounts.google.com/signin/v2/identifier?hl=vi&flowName=GlifWebSignIn&flowEntry=ServiceLogin',
            }}
            userAgent={chromeUserAgent}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            incognito={true}
            injectedJavaScript={injectedVerifierScript}
            onMessage={handleVerifyMessage}
            onNavigationStateChange={(navState) => {
              const url = navState.url || '';
              if (
                url.includes('/challenge/') ||
                url.includes('/pwd') ||
                url.includes('/v2/challenge')
              ) {
                if (!isResolvingRef.current) {
                  isResolvingRef.current = true;
                  if (verifyTimeoutRef.current) {
                    clearTimeout(verifyTimeoutRef.current);
                    verifyTimeoutRef.current = null;
                  }
                  setIsVerifying(false);
                  performAccountCreation(verifyingEmail);
                }
              }
            }}
            style={styles.hiddenWebView}
          />
        </View>
      ) : null}

      {/* Modal Cấu hình gửi Mail vào Gmail qua Google Apps Script Web App */}
      <Modal visible={mailConfigModalVisible} transparent animationType="slide">
        <View style={styles.mailModalOverlay}>
          <View style={styles.mailModalCard}>
            <View style={styles.mailModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.mailModalTitle}>Cấu hình gửi mã vào Gmail ✉️</Text>
                <Text style={styles.mailModalSubtitle}>
                  Tự động chuyển mã 6 số về Hòm thư đến của người dùng
                </Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseIconBtn}
                onPress={() => setMailConfigModalVisible(false)}
              >
                <Text style={styles.modalCloseIconText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
              {/* Trạng thái hiện tại */}
              <View style={styles.mailConfigStatusCard}>
                <View style={styles.mailConfigStatusHeader}>
                  <View
                    style={[
                      styles.mailStatusDotLarge,
                      {
                        backgroundColor: currentMailConfig.gasUrl ? '#10B981' : '#F59E0B',
                      },
                    ]}
                  />
                  <Text style={styles.mailConfigStatusTitle}>
                    {currentMailConfig.gasUrl
                      ? 'Đã kết nối Google Apps Script'
                      : 'Chưa cấu hình URL gửi mail'}
                  </Text>
                </View>
                <Text style={styles.mailConfigStatusDesc}>
                  {currentMailConfig.gasUrl
                    ? 'Hệ thống đã sẵn sàng gửi mã kích hoạt tự động vào hòm thư Gmail của bất kỳ tài khoản nào được thêm.'
                    : 'Chưa có Webhook: Mã được lưu vào hệ thống nhưng chưa thể tự động chuyển tới hòm thư Gmail.'}
                </Text>
              </View>

              {/* Ô nhập Google Apps Script URL */}
              <View style={styles.mailInputGroup}>
                <Text style={styles.mailInputLabel}>URL GOOGLE APPS SCRIPT WEB APP</Text>
                <TextInput
                  style={styles.mailTextInput}
                  placeholder="https://script.google.com/macros/s/.../exec"
                  placeholderTextColor="#94A3B8"
                  value={gasUrlInput}
                  onChangeText={setGasUrlInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {/* Thử nghiệm gửi email */}
              <View style={styles.testMailBox}>
                <Text style={styles.testMailTitle}>Kiểm tra gửi email thực tế 🚀</Text>
                <Text style={styles.testMailDesc}>
                  Nhập địa chỉ Gmail của bạn và bấm để kiểm tra hòm thư có nhận được mã không:
                </Text>
                <View style={styles.testMailInputRow}>
                  <TextInput
                    style={styles.testMailInput}
                    placeholder="email-cua-ban@gmail.com"
                    placeholderTextColor="#94A3B8"
                    value={testEmailInput}
                    onChangeText={setTestEmailInput}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                  <TouchableOpacity
                    style={[styles.testMailBtn, isTestingMail && { opacity: 0.7 }]}
                    onPress={handleTestSendMail}
                    disabled={isTestingMail}
                  >
                    {isTestingMail ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.testMailBtnText}>Gửi thử</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {/* Hướng dẫn tạo Google Apps Script */}
              <View style={styles.guideBox}>
                <Text style={styles.guideTitle}>📖 Cách tạo Google Apps Script miễn phí (1 phút):</Text>
                <Text style={styles.guideStep}>
                  <Text style={styles.guideStepNum}>1. </Text>
                  Mở trang web <Text style={styles.guideBold}>script.google.com</Text> bằng tài khoản Google của bạn &gt; Nhấn <Text style={styles.guideBold}>Dự án mới</Text>.
                </Text>
                <Text style={styles.guideStep}>
                  <Text style={styles.guideStepNum}>2. </Text>
                  Xóa code cũ, dán đoạn code gửi mail sau:
                </Text>
                <View style={styles.codeSnippetBox}>
                  <Text style={styles.codeSnippetText}>
{`function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    var senderName = d.senderName || "CareDrop Support";
    var html = (d.html || d.text || "").replace(/\\uFFFD+/g, '').replace(/👉|🛡️/g, '');
    var subject = (d.subject || "").replace(/\\uFFFD+/g, '').replace(/👉|🛡️/g, '');
    var text = (d.text || "").replace(/\\uFFFD+/g, '').replace(/👉|🛡️/g, '');
    GmailApp.sendEmail(d.to, subject, text, {
      htmlBody: html,
      name: senderName
    });
    return ContentService.createTextOutput(JSON.stringify({success:true,to:d.to})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({success:false,error:err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({status:"ready"})).setMimeType(ContentService.MimeType.JSON);
}`}
                  </Text>
                </View>
                <Text style={styles.guideStep}>
                  <Text style={styles.guideStepNum}>3. </Text>
                  Nhấn <Text style={styles.guideBold}>Triển khai (Deploy)</Text> &gt; <Text style={styles.guideBold}>Tùy chọn triển khai mới</Text> &gt; Chọn loại <Text style={styles.guideBold}>Ứng dụng web</Text> &gt; Chọn Quyền truy cập: <Text style={styles.guideBold}>Bất kỳ ai (Anyone)</Text> &gt; Bấm <Text style={styles.guideBold}>Triển khai</Text> rồi sao chép Web App URL dán vào ô ở trên.
                </Text>
              </View>
            </ScrollView>

            {/* Nút thao tác */}
            <View style={styles.mailModalActionRow}>
              <TouchableOpacity
                style={styles.mailModalCancelBtn}
                onPress={() => setMailConfigModalVisible(false)}
              >
                <Text style={styles.mailModalCancelText}>Đóng</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.mailModalSaveBtn, isSavingMailConfig && { opacity: 0.7 }]}
                onPress={handleSaveMailConfig}
                disabled={isSavingMailConfig}
              >
                {isSavingMailConfig ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.mailModalSaveText}>Lưu cấu hình</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    paddingVertical: 14,
  },
  accountItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  accountTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
  avatarAdmin: {
    backgroundColor: '#E0E7FF',
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
  avatarTextAdmin: {
    color: '#4338CA',
  },
  accountInfo: {
    flex: 1,
  },
  accountNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 2,
  },
  accountName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  lockedPill: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  lockedPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#DC2626',
  },
  pendingPill: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  pendingPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#D97706',
  },
  accountEmailText: {
    fontSize: 13,
    color: '#007AFF',
    fontWeight: '600',
    marginTop: 2,
    marginBottom: 4,
  },
  accountMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  accountRolePill: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  accountRolePillMonitored: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  accountRolePillSupervisor: {
    backgroundColor: 'rgba(0, 122, 255, 0.12)',
    borderColor: 'rgba(0, 122, 255, 0.3)',
  },
  accountRolePillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  accountRolePillTextMonitored: {
    color: '#10B981',
  },
  accountRolePillTextSupervisor: {
    color: '#007AFF',
  },
  accountMetaSub: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  pendingCodeBox: {
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 6,
  },
  pendingCodeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  accountActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnLock: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  actionBtnOpen: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  actionBtnDelete: {
    backgroundColor: '#FFF1F2',
    borderColor: '#FFE4E6',
  },
  actionBtnRole: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  actionRoleText: {
    color: '#16A34A',
    fontSize: 12,
    fontWeight: '700',
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  actionLockText: {
    color: '#EF4444',
  },
  actionOpenText: {
    color: '#10B981',
  },
  actionDeleteText: {
    color: '#E11D48',
    fontSize: 12,
    fontWeight: '700',
  },
  actionBtnResend: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  actionResendText: {
    color: '#007AFF',
    fontSize: 12,
    fontWeight: '700',
  },
  adminBadgeRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    alignItems: 'flex-start',
  },
  adminBadgeRowText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563EB',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },

  /* ── Pending Approval Section ── */
  pendingBadgeCount: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pendingBadgeCountText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#D97706',
  },
  emptyPendingBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyPendingText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  pendingList: {
    marginTop: 4,
  },
  pendingCardItem: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
  },
  pendingCardItemBorder: {
    marginBottom: 10,
  },
  pendingCardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  pendingCardName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  pendingCardEmail: {
    fontSize: 13,
    color: '#007AFF',
    fontWeight: '600',
    marginTop: 1,
  },
  pendingCardPhone: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  pendingRolePill: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pendingRolePillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  pendingWaitText: {
    fontSize: 11,
    color: '#D97706',
    fontWeight: '600',
  },
  pendingActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  pendingApproveBtn: {
    flex: 1,
    backgroundColor: '#0284C7',
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingApproveText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  pendingRejectBtn: {
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FECDD3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingRejectText: {
    color: '#E11D48',
    fontSize: 13,
    fontWeight: '700',
  },
  adminBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  adminBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  totalCountBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  totalCountText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },


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

  /* ── Verification Modal & Hidden WebView ── */
  verifyingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  verifyingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    width: '100%',
    maxWidth: 340,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  verifyingTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 16,
    textAlign: 'center',
  },
  verifyingEmail: {
    fontSize: 14,
    fontWeight: '700',
    color: '#007AFF',
    marginTop: 6,
    textAlign: 'center',
  },
  verifyingSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
    textAlign: 'center',
  },
  cancelVerifyBtn: {
    marginTop: 20,
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
  },
  cancelVerifyBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  hiddenWebViewContainer: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 1,
    height: 1,
    opacity: 0.01,
    overflow: 'hidden',
  },
  hiddenWebView: {
    width: 320,
    height: 480,
  },

  // Mail Status Banner & Pending Code Row
  mailStatusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  mailStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  mailStatusTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E3A8A',
  },
  mailStatusSubtitle: {
    fontSize: 11,
    color: '#3B82F6',
    marginTop: 2,
  },
  mailStatusBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#007AFF',
    marginLeft: 8,
  },
  pendingCodeRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  pendingCodeStatusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0284C7',
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  revealedCodeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#D97706',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  revealCodeBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    textDecorationLine: 'underline',
  },

  // Modal Cấu hình gửi mail
  mailModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  mailModalCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    maxHeight: '90%',
  },
  mailModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  mailModalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  mailModalSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  modalCloseIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseIconText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
  },
  mailConfigStatusCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    marginBottom: 16,
  },
  mailConfigStatusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  mailStatusDotLarge: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  mailConfigStatusTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  mailConfigStatusDesc: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
  },
  mailInputGroup: {
    marginBottom: 16,
  },
  mailInputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  mailTextInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0F172A',
  },
  testMailBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DBEAFE',
    padding: 12,
    marginBottom: 16,
  },
  testMailTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E40AF',
    marginBottom: 4,
  },
  testMailDesc: {
    fontSize: 12,
    color: '#3B82F6',
    marginBottom: 8,
    lineHeight: 16,
  },
  testMailInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  testMailInput: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0F172A',
  },
  testMailBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  testMailBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  guideBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    marginBottom: 16,
  },
  guideTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
  },
  guideStep: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 18,
    marginBottom: 6,
  },
  guideStepNum: {
    fontWeight: '800',
    color: '#007AFF',
  },
  guideBold: {
    fontWeight: '700',
    color: '#0F172A',
  },
  codeSnippetBox: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 10,
    marginVertical: 6,
  },
  codeSnippetText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    color: '#38BDF8',
    lineHeight: 14,
  },
  mailModalActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  mailModalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
  },
  mailModalCancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  mailModalSaveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: '#007AFF',
  },
  mailModalSaveText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
