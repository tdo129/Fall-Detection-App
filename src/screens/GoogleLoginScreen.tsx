import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Alert,
  ActivityIndicator,
  Platform,
  ScrollView,
  StatusBar,
  Linking,
  TextInput,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../context/AuthContext';
import { resendActivationCode, registerUserPendingApproval } from '../services/authService';
import { COLORS, FONT, RADIUS, SHADOW, SPACING } from '../constants/theme';

export default function GoogleLoginScreen() {
  const { login, loginWithPassword, activateAccount } = useAuth();
  const webViewRef = useRef<WebView>(null);

  const [isWebModalVisible, setWebModalVisible] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [detectedEmail, setDetectedEmail] = useState<string | null>(null);
  const [webViewKey, setWebViewKey] = useState(1);
  const lastRejectedEmailRef = useRef<string | null>(null);

  // State cho Đăng nhập bằng Mật khẩu (cho tài khoản do Admin cấp hoặc Quản trị viên)
  const [isCredModalVisible, setCredModalVisible] = useState(false);
  const [credEmail, setCredEmail] = useState('');
  const [credPassword, setCredPassword] = useState('');
  const [isCredLoading, setIsCredLoading] = useState(false);

  // State cho Modal Kích hoạt tài khoản bằng mã gửi về Gmail
  const [isActivationModalVisible, setActivationModalVisible] = useState(false);
  const [activationEmail, setActivationEmail] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [isActivating, setIsActivating] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [pendingUserProfile, setPendingUserProfile] = useState<{
    uid: string;
    email: string;
    displayName?: string;
    photoURL?: string;
  } | null>(null);

  // State cho Modal Đăng ký tài khoản Gmail mới
  const [isRegModalVisible, setRegModalVisible] = useState(false);
  const [regFullName, setRegFullName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regRole, setRegRole] = useState<'supervisor' | 'monitored_person'>('supervisor');
  const [isRegistering, setIsRegistering] = useState(false);

  // Modern Mobile Chrome user agent to prevent 403 disallowed_useragent from Google
  const chromeUserAgent =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

  // Injected JavaScript that runs inside accounts.google.com / myaccount.google.com
  const injectedAuthScript = `
    (function() {
      function detectAndSend() {
        try {
          var url = window.location.href;

          // Only consider authenticated once Google redirects away from the login/password prompt
          var isPostLogin = (
            url.indexOf('myaccount.google.com') !== -1 ||
            url.indexOf('accounts.google.com/ManageAccount') !== -1 ||
            url.indexOf('accounts.google.com/b/') !== -1 ||
            (url.indexOf('google.com') !== -1 && 
             url.indexOf('/signin') === -1 && 
             url.indexOf('/ServiceLogin') === -1 && 
             url.indexOf('/AccountChooser') === -1 && 
             url.indexOf('/chooser') === -1 && 
             url.indexOf('/v3/signin') === -1 && 
             url.indexOf('/identifier') === -1 && 
             url.indexOf('/challenge') === -1 &&
             url.indexOf('/speedbump') === -1)
          );

          if (!isPostLogin) return false;

          var email = null;
          var displayName = null;
          var photoURL = null;

          // 1. Check aria-label on Google account badge
          // Standard Google label format: "Tài khoản Google: Nguyễn Văn A (email@gmail.com)" or "Google Account: Name (email@...)"
          var ariaEls = document.querySelectorAll('[aria-label*="@"]');
          for (var i = 0; i < ariaEls.length; i++) {
            var label = ariaEls[i].getAttribute('aria-label') || '';
            var emailMatch = label.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (emailMatch && emailMatch[1]) {
              email = emailMatch[1];
              var nameMatch = label.match(/^(?:Tài khoản Google|Google Account|Tài khoản|Account)?[:\s]*([^\n(:]+?)(?:\s*\([a-zA-Z0-9._%+-]+@|\n|$)/i);
              if (nameMatch && nameMatch[1] && nameMatch[1].trim().length > 1) {
                displayName = nameMatch[1].trim();
              }
              break;
            }
          }

          // 2. Check data-email / data-identifier attributes
          if (!email) {
            var dataEls = document.querySelectorAll('[data-email], [data-identifier]');
            for (var j = 0; j < dataEls.length; j++) {
              var val = dataEls[j].getAttribute('data-email') || dataEls[j].getAttribute('data-identifier');
              if (val && val.indexOf('@') !== -1 && val.indexOf('@google.com') === -1) {
                email = val;
                break;
              }
            }
          }

          // 3. Check Google avatar
          var avatarImg = document.querySelector('img[src*="googleusercontent.com"]');
          if (avatarImg) {
            photoURL = avatarImg.getAttribute('src');
          }

          // 4. Scan document text if on myaccount.google.com
          if (!email && url.indexOf('myaccount.google.com') !== -1) {
            var bodyText = document.body ? document.body.innerText : '';
            var matches = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
            if (matches) {
              for (var k = 0; k < matches.length; k++) {
                var candidate = matches[k];
                if (candidate.indexOf('@google.com') === -1 && candidate.indexOf('example') === -1) {
                  email = candidate;
                  break;
                }
              }
            }
          }

          // 5. Check heading for Display Name
          if (!displayName) {
            var h1 = document.querySelector('h1');
            if (h1 && h1.innerText) {
              var h1Text = h1.innerText;
              var h1Match = h1Text.match(/(?:Chào mừng|Welcome)[,\s]+([^!.\n]+)/i);
              if (h1Match && h1Match[1]) {
                displayName = h1Match[1].trim();
              }
            }
          }

          // If valid authenticated Google email is found, send to React Native!
          if (email && email.indexOf('@') !== -1) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'GOOGLE_AUTH_SUCCESS',
              email: email.trim().toLowerCase(),
              displayName: displayName || email.split('@')[0],
              photoURL: photoURL || ''
            }));
            return true;
          }
        } catch (e) {
          // ignore error
        }
        return false;
      }

      // Check repeatedly after page loads
      var interval = setInterval(function() {
        if (detectAndSend()) {
          clearInterval(interval);
        }
      }, 700);

      detectAndSend();
    })();
    true;
  `;

  // Handler when Google login is successfully confirmed from WebView
  const handleGoogleAuthSuccess = async (profile: {
    email: string;
    displayName: string;
    photoURL?: string;
  }) => {
    const cleanMail = profile.email.trim().toLowerCase();
    try {
      setIsAuthenticating(true);
      setDetectedEmail(cleanMail);

      // Perform login in AuthContext and sync with Firestore
      await login({
        uid: cleanMail,
        email: cleanMail,
        displayName: profile.displayName || cleanMail.split('@')[0],
        photoURL: profile.photoURL || '',
      });

      lastRejectedEmailRef.current = null;

      // Close modal smoothly
      setTimeout(() => {
        setWebModalVisible(false);
        setIsAuthenticating(false);
      }, 600);
    } catch (err: any) {
      setIsAuthenticating(false);
      setWebModalVisible(false);
      setDetectedEmail(null);

      const errMsg: string = err?.message || '';

      if (errMsg.startsWith('PENDING_APPROVAL:')) {
        const pendingEmail = errMsg.replace('PENDING_APPROVAL:', '').trim();
        lastRejectedEmailRef.current = pendingEmail;
        Alert.alert(
          'Đang chờ Quản trị viên duyệt ⏳',
          `Yêu cầu đăng ký tài khoản Gmail [${pendingEmail}] đang chờ Quản trị viên xét duyệt.\n\nSau khi Quản trị viên phê duyệt, mã xác nhận kích hoạt gồm 6 chữ số sẽ được gửi về hộp thư Gmail của bạn. Vui lòng quay lại sau!`,
          [{ text: 'Đã hiểu', style: 'default' }]
        );
      } else if (errMsg.startsWith('PENDING_ACTIVATION:')) {
        const pendingEmail = errMsg.replace('PENDING_ACTIVATION:', '').trim();
        lastRejectedEmailRef.current = null;
        setActivationEmail(pendingEmail);
        setPendingUserProfile({
          uid: cleanMail,
          email: cleanMail,
          displayName: profile.displayName || cleanMail.split('@')[0],
          photoURL: profile.photoURL || '',
        });
        setActivationCode('');
        setActivationModalVisible(true);
      } else if (errMsg.startsWith('UNREGISTERED_GMAIL:')) {
        const unregEmail = errMsg.replace('UNREGISTERED_GMAIL:', '').trim();
        lastRejectedEmailRef.current = unregEmail;

        Alert.alert(
          'Gmail chưa được đăng ký ⚠️',
          `Tài khoản Gmail (${unregEmail}) chưa được thêm vào hệ thống CareDrop.\n\nBạn có muốn gửi yêu cầu đăng ký tài khoản này ngay bây giờ để được Quản trị viên cấp phép không?`,
          [
            {
              text: 'Đăng ký ngay 📝',
              onPress: () => {
                setRegEmail(unregEmail);
                setRegFullName(profile.displayName || '');
                setRegModalVisible(true);
              },
            },
            {
              text: 'Đóng',
              style: 'cancel',
            },
          ],
          { cancelable: false }
        );
      } else if (errMsg.includes('khóa')) {
        lastRejectedEmailRef.current = cleanMail;
        Alert.alert(
          'Tài khoản bị khóa 🔒',
          errMsg,
          [
            {
              text: 'Đăng nhập lại',
              onPress: () => {
                setWebViewKey((prev) => prev + 1);
                setTimeout(() => {
                  setWebModalVisible(true);
                }, 300);
              },
            },
            {
              text: 'Đóng',
              style: 'cancel',
            },
          ],
          { cancelable: false }
        );
      } else if (
        errMsg.toLowerCase().includes('offline') ||
        errMsg.toLowerCase().includes('unavailable') ||
        errMsg.toLowerCase().includes('network')
      ) {
        Alert.alert(
          'Kết nối máy chủ bị gián đoạn 🌐',
          'Không thể kết nối đến máy chủ dữ liệu do thiết bị đang ngoại tuyến hoặc kết nối mạng không ổn định.\n\nVui lòng kiểm tra lại kết nối Wifi/4G của bạn và thử đăng nhập lại.',
          [
            {
              text: 'Đăng nhập lại',
              onPress: () => {
                setWebViewKey((prev) => prev + 1);
                setTimeout(() => {
                  setWebModalVisible(true);
                }, 300);
              },
            },
            {
              text: 'Đóng',
              style: 'cancel',
            },
          ]
        );
      } else {
        Alert.alert('Lỗi đăng nhập', errMsg || 'Không thể đồng bộ tài khoản Google.');
      }
    }
  };

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'GOOGLE_AUTH_SUCCESS' && data.email) {
        // Tránh vòng lặp kích hoạt lại ngay email vừa bị từ chối
        if (data.email.trim().toLowerCase() === lastRejectedEmailRef.current) {
          return;
        }
        handleGoogleAuthSuccess(data);
      }
    } catch (e) {
      // not JSON or unrelated message
    }
  };

  // Trigger manual extraction when user clicks "Xác nhận vào app"
  const handleManualExtraction = () => {
    lastRejectedEmailRef.current = null;
    webViewRef.current?.injectJavaScript(`
      (function() {
        var email = null;
        var displayName = null;
        var ariaEls = document.querySelectorAll('[aria-label*="@"]');
        for (var i = 0; i < ariaEls.length; i++) {
          var label = ariaEls[i].getAttribute('aria-label') || '';
          var m = label.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
          if (m) {
            email = m[1];
            break;
          }
        }
        if (!email) {
          var text = document.body ? document.body.innerText : '';
          var matches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
          if (matches) {
            for (var k = 0; k < matches.length; k++) {
              if (matches[k].indexOf('@google.com') === -1) {
                email = matches[k];
                break;
              }
            }
          }
        }
        if (email) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'GOOGLE_AUTH_SUCCESS',
            email: email.trim().toLowerCase(),
            displayName: displayName || email.split('@')[0]
          }));
        } else {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'GOOGLE_AUTH_NOT_FOUND',
            url: window.location.href
          }));
        }
      })();
      true;
    `);
  };

  // Đăng nhập Quản trị viên khẩn cấp (Chỉ dành cho ntuankiet0201@gmail.com)
  const handleCredentialLogin = async () => {
    const cleanMail = credEmail.trim().toLowerCase();
    const cleanPass = credPassword.trim();
    if (!cleanMail || !cleanPass) {
      Alert.alert('Chưa nhập đủ thông tin', 'Vui lòng nhập đầy đủ Email và Mật khẩu.');
      return;
    }
    setIsCredLoading(true);
    try {
      await loginWithPassword(cleanMail, cleanPass);
      setCredModalVisible(false);
    } catch (err: any) {
      const errMsg: string = err?.message || '';
      if (errMsg.startsWith('PENDING_APPROVAL:')) {
        const pendingEmail = errMsg.replace('PENDING_APPROVAL:', '').trim();
        Alert.alert(
          'Đang chờ Quản trị viên duyệt ⏳',
          `Tài khoản Gmail [${pendingEmail}] đang chờ Quản trị viên phê duyệt.\n\nSau khi Quản trị viên cho phép, mã kích hoạt gồm 6 chữ số sẽ được gửi về Gmail của bạn.`,
          [{ text: 'Đã hiểu' }]
        );
        return;
      }
      if (errMsg.startsWith('PENDING_ACTIVATION:')) {
        const pendingEmail = errMsg.replace('PENDING_ACTIVATION:', '').trim();
        setActivationEmail(pendingEmail);
        setActivationCode('');
        setCredModalVisible(false);
        setActivationModalVisible(true);
        return;
      }
      Alert.alert('Đăng nhập thất bại', errMsg || 'Mật khẩu Quản trị viên không chính xác.');
    } finally {
      setIsCredLoading(false);
    }
  };

  // Xử lý gửi yêu cầu đăng ký tài khoản Gmail mới tới Quản trị viên
  const handleRegisterSubmit = async () => {
    const cleanName = regFullName.trim();
    const cleanMail = regEmail.trim().toLowerCase();
    const cleanPhone = regPhone.trim();

    if (!cleanName) {
      Alert.alert('Chưa nhập Họ và tên', 'Vui lòng nhập đầy đủ Họ và tên của bạn.');
      return;
    }

    if (!cleanMail) {
      Alert.alert('Chưa nhập Gmail', 'Vui lòng nhập địa chỉ Gmail của bạn.');
      return;
    }

    setIsRegistering(true);
    try {
      await registerUserPendingApproval({
        displayName: cleanName,
        email: cleanMail,
        phoneNumber: cleanPhone,
        role: regRole,
      });

      const roleLabel =
        regRole === 'monitored_person' ? 'Người được giám sát' : 'Người giám sát';

      setRegModalVisible(false);
      setRegFullName('');
      setRegEmail('');
      setRegPhone('');

      Alert.alert(
        'Gửi yêu cầu đăng ký thành công! 🎉',
        `Yêu cầu đăng ký tài khoản Gmail [${cleanMail}] với phân quyền "${roleLabel}" đã được gửi tới Quản trị viên.\n\n⏳ Sau khi Quản trị viên xem xét và cho phép, mã xác nhận kích hoạt gồm 6 chữ số sẽ được gửi về hộp thư Gmail của bạn.\n\n⚠️ Lưu ý: Sau khi đăng ký, phân quyền này sẽ không thể tự thay đổi, bạn chỉ có thể liên hệ Quản trị viên để đổi phân quyền.`
      );
    } catch (err: any) {
      Alert.alert('Lỗi đăng ký', err.message || 'Không thể gửi yêu cầu đăng ký.');
    } finally {
      setIsRegistering(false);
    }
  };

  // Xác nhận mã kích hoạt 6 số gửi về Gmail
  const handleConfirmActivation = async () => {
    const cleanMail = activationEmail.trim().toLowerCase();
    const cleanCode = activationCode.trim();
    if (!cleanMail || !cleanCode || cleanCode.length < 6) {
      Alert.alert('Chưa nhập mã', 'Vui lòng nhập đủ 6 chữ số mã kích hoạt đã gửi về Gmail.');
      return;
    }
    setIsActivating(true);
    try {
      await activateAccount(cleanMail, cleanCode, pendingUserProfile || undefined);
      setActivationModalVisible(false);
      setActivationCode('');
      setPendingUserProfile(null);
      Alert.alert('Thành công! 🎉', 'Tài khoản đã được kích hoạt thành công.');
    } catch (err: any) {
      Alert.alert('Kích hoạt thất bại ❌', err.message || 'Mã kích hoạt không chính xác hoặc đã hết hạn.');
    } finally {
      setIsActivating(false);
    }
  };

  // Gửi lại mã kích hoạt mới trực tiếp về hòm thư Gmail của người dùng
  const handleResendActivationCodeFromModal = async () => {
    const cleanMail = activationEmail.trim().toLowerCase();
    if (!cleanMail) return;
    setIsResending(true);
    try {
      await resendActivationCode(cleanMail);
      Alert.alert(
        'Đã gửi lại mã kích hoạt ✉️',
        `Mã kích hoạt mới đã được gửi về hòm thư Gmail [${cleanMail}].\n\nVui lòng mở ứng dụng Gmail trên điện thoại, kiểm tra Hộp thư đến (Inbox) hoặc Thư rác (Spam) để lấy mã.`
      );
    } catch (e: any) {
      Alert.alert('Lỗi gửi mã', e?.message || 'Không thể gửi lại mã kích hoạt vào thời điểm này.');
    } finally {
      setIsResending(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Background Gradient */}
      <LinearGradient
        colors={['#0D1117', '#161B22', '#0A0E14']}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* App Branding */}
        <View style={styles.brandHeader}>
          <View style={styles.appIconWrap}>
            <Text style={styles.appIcon}>🛡️</Text>
          </View>
          <Text style={styles.appTitle}>CareDrop</Text>
          <Text style={styles.appSubtitle}>Hệ thống Giám sát & Nhận diện Té ngã 24/7</Text>
        </View>

        {/* ── GOOGLE AUTHENTICATION CARD ── */}
        <View style={[styles.googleCard, SHADOW.lg]}>
          {/* Multi-colored Google G Icon */}
          <View style={styles.googleGLogoRow}>
            <View style={styles.googleGLogo}>
              <Text style={styles.googleGText}>G</Text>
            </View>
            <View style={styles.googleVerifiedBadge}>
              <Text style={styles.googleVerifiedText}>🔒 Xác thực mỗi lần vào app</Text>
            </View>
          </View>

          <Text style={styles.cardTitle}>Đăng nhập với Google</Text>
          <Text style={styles.cardSubtitle}>
            Vui lòng đăng nhập tài khoản Gmail của bạn để vào ứng dụng và nhận cảnh báo té ngã.
          </Text>

          {/* Security Notice Box */}
          <View style={styles.securityBox}>
            <Text style={styles.securityBoxIcon}>🛡️</Text>
            <View style={styles.securityBoxContent}>
              <Text style={styles.securityBoxTitle}>Chỉ Gmail thật trên Google & được cấp phép</Text>
              <Text style={styles.securityBoxText}>
                • Đăng nhập trực tiếp qua cổng Google (accounts.google.com).{'\n'}
                • Tài khoản bắt buộc phải tồn tại thật trên Google và được Quản trị viên thêm vào hệ thống.{'\n'}
                • Tuyệt đối không cho phép tài khoản ảo hoặc nhập tùy tiện.
              </Text>
            </View>
          </View>

          {/* MAIN GOOGLE SIGN IN BUTTON */}
          <TouchableOpacity
            style={styles.googleMainBtn}
            onPress={() => {
              lastRejectedEmailRef.current = null;
              setWebViewKey((prev) => prev + 1);
              setWebModalVisible(true);
            }}
            activeOpacity={0.85}
          >
            <View style={styles.googleBtnIconBox}>
              <Text style={styles.googleBtnG}>G</Text>
            </View>
            <Text style={styles.googleMainBtnText}>Tiếp tục với Google</Text>
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.loginDivider}>
            <View style={styles.loginDividerLine} />
            <Text style={styles.loginDividerText}>HOẶC</Text>
            <View style={styles.loginDividerLine} />
          </View>

          {/* REGISTER ACCOUNT BUTTON */}
          <TouchableOpacity
            style={styles.registerBtn}
            onPress={() => setRegModalVisible(true)}
            activeOpacity={0.85}
          >
            <Text style={styles.registerBtnIcon}>📝</Text>
            <Text style={styles.registerBtnText}>Đăng ký tài khoản Gmail mới</Text>
          </TouchableOpacity>

          {/* ACTIVATE WITH CODE LINK */}
          <TouchableOpacity
            style={styles.activateCodeLink}
            onPress={() => {
              setActivationEmail('');
              setActivationCode('');
              setActivationModalVisible(true);
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.activateCodeLinkText}>
              🔑 Đã có mã kích hoạt từ Quản trị viên? Nhập mã tại đây
            </Text>
          </TouchableOpacity>

          <Text style={styles.guaranteeText}>
            ✓ Đăng nhập an toàn qua máy chủ chính thức accounts.google.com
          </Text>
        </View>

        {/* Google Style Footer */}
        <View style={styles.googleFooter}>
          <Text style={styles.footerLanguage}>Tiếng Việt</Text>
          <View style={styles.footerLinks}>
            <TouchableOpacity onPress={() => Linking.openURL('https://support.google.com/accounts')}>
              <Text style={styles.footerLinkItem}>Trợ giúp</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => Linking.openURL('https://policies.google.com/privacy')}>
              <Text style={styles.footerLinkItem}>Bảo mật</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => Linking.openURL('https://policies.google.com/terms')}>
              <Text style={styles.footerLinkItem}>Điều khoản</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Admin Emergency Entry */}
        <View style={{ alignItems: 'center', marginTop: 12, marginBottom: 20 }}>
          <TouchableOpacity
            onPress={() => {
              setCredEmail('ntuankiet0201@gmail.com');
              setCredPassword('');
              setCredModalVisible(true);
            }}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 11, color: '#475569' }}>
              ⚙️ Dành cho Quản trị viên (Khẩn cấp)
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ── CỬA SỔ ĐĂNG NHẬP GOOGLE CHÍNH THỨC (accounts.google.com) ── */}
      <Modal
        visible={isWebModalVisible}
        animationType="slide"
        onRequestClose={() => {
          if (!isAuthenticating) setWebModalVisible(false);
        }}
      >
        <View style={styles.webModalRoot}>
          <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

          {/* Header */}
          <View style={styles.webModalHeader}>
            <TouchableOpacity
              style={styles.webModalCloseBtn}
              onPress={() => setWebModalVisible(false)}
              disabled={isAuthenticating}
            >
              <Text style={styles.webModalCloseText}>✕ Hủy</Text>
            </TouchableOpacity>

            <View style={styles.webModalTitleWrap}>
              <Text style={styles.webModalHeaderTitle}>🔒 accounts.google.com</Text>
              <Text style={styles.webModalHeaderSubtitle}>Cổng đăng nhập Google chính hãng</Text>
            </View>

            <TouchableOpacity
              style={styles.webModalDoneBtn}
              onPress={handleManualExtraction}
              disabled={isAuthenticating}
              activeOpacity={0.8}
            >
              <Text style={styles.webModalDoneText}>Vào app ›</Text>
            </TouchableOpacity>
          </View>

          {/* Authenticating Overlay */}
          {isAuthenticating && (
            <View style={styles.authOverlay}>
              <ActivityIndicator size="large" color="#0B57D0" />
              <Text style={styles.authOverlayTitle}>Đã xác thực tài khoản Google!</Text>
              <Text style={styles.authOverlayEmail}>{detectedEmail}</Text>
              <Text style={styles.authOverlaySubtitle}>Đang đồng bộ và mở ứng dụng...</Text>
            </View>
          )}

          {/* Official Google Login WebView */}
          <WebView
            key={webViewKey}
            ref={webViewRef}
            source={{
              uri: 'https://accounts.google.com/AccountChooser?continue=https://myaccount.google.com/',
            }}
            userAgent={chromeUserAgent}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            injectedJavaScript={injectedAuthScript}
            onMessage={handleMessage}
            startInLoadingState={true}
            renderLoading={() => (
              <View style={styles.webLoadingWrap}>
                <ActivityIndicator size="large" color="#0B57D0" />
                <Text style={styles.webLoadingText}>Đang tải cổng đăng nhập Google an toàn...</Text>
              </View>
            )}
            onNavigationStateChange={(navState) => {
              // Whenever page changes (e.g. redirect to myaccount.google.com), re-run extraction
              if (
                navState.url.includes('myaccount.google.com') ||
                navState.url.includes('accounts.google.com/ManageAccount') ||
                navState.url.includes('google.com/?')
              ) {
                webViewRef.current?.injectJavaScript(injectedAuthScript);
              }
            }}
          />

          {/* Bottom helper bar inside WebView */}
          <View style={styles.webBottomBar}>
            <Text style={styles.webBottomBarText}>
              💡 Sau khi bạn đăng nhập tài khoản Google của mình, CareDrop sẽ tự động nhận diện và đưa bạn vào ứng dụng.
            </Text>
          </View>
        </View>
      </Modal>

      {/* ── CỬA SỔ ĐĂNG NHẬP QUẢN TRỊ VIÊN KHẨN CẤP ── */}
      <Modal
        visible={isCredModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.credModalOverlay}>
          <View style={styles.credModalCard}>
            <View style={styles.credModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.credModalTitle}>Quản trị viên Khẩn cấp</Text>
                <Text style={styles.credModalSubtitle}>
                  Chỉ dành cho Quản trị viên (ntuankiet0201@gmail.com). Người dùng bắt buộc phải đăng nhập bằng Google.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.credCloseBtn}
                onPress={() => setCredModalVisible(false)}
              >
                <Text style={styles.credCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              <TouchableOpacity
                style={{ backgroundColor: '#1E293B', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#334155' }}
                onPress={() => {
                  setCredEmail('ntuankiet0201@gmail.com');
                  setCredPassword('admin123');
                }}
              >
                <Text style={{ color: '#38BDF8', fontSize: 12, fontWeight: '600' }}>👑 Quản trị viên</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ backgroundColor: '#1E293B', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#334155' }}
                onPress={() => {
                  setCredEmail('nguyenbaophuc0102@gmail.com');
                  setCredPassword('123456');
                }}
              >
                <Text style={{ color: '#34D399', fontSize: 12, fontWeight: '600' }}>👁️ Người giám sát</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.credInputGroup}>
              <Text style={styles.credInputLabel}>EMAIL TÀI KHOẢN</Text>
              <TextInput
                style={styles.credInput}
                placeholder="email@gmail.com"
                placeholderTextColor="#64748B"
                value={credEmail}
                onChangeText={setCredEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.credInputGroup}>
              <Text style={styles.credInputLabel}>MẬT KHẨU</Text>
              <TextInput
                style={styles.credInput}
                placeholder="Nhập mật khẩu"
                placeholderTextColor="#64748B"
                value={credPassword}
                onChangeText={setCredPassword}
                secureTextEntry
                autoCapitalize="none"
              />
            </View>

            <TouchableOpacity
              style={[styles.credSubmitBtn, isCredLoading && { opacity: 0.7 }]}
              onPress={handleCredentialLogin}
              disabled={isCredLoading}
              activeOpacity={0.85}
            >
              {isCredLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.credSubmitText}>Đăng nhập ngay ›</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── CỬA SỔ NHẬP MÃ KÍCH HOẠT TÀI KHOẢN (GỬI VỀ GMAIL) ── */}
      <Modal
        visible={isActivationModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.credModalOverlay}>
          <View style={styles.activationCard}>
            <View style={styles.credModalHeader}>
              <View style={{ flex: 1 }}>
                <View style={styles.activationBadge}>
                  <Text style={styles.activationBadgeText}>📩 YÊU CẦU KÍCH HOẠT</Text>
                </View>
                <Text style={styles.activationTitle}>Xác nhận kích hoạt Gmail</Text>
                <Text style={styles.activationSubtitle}>
                  Mã xác nhận gồm 6 chữ số đã được gửi tới Gmail của bạn. Vui lòng kiểm tra hộp thư đến (hoặc Spam).
                </Text>
              </View>
              <TouchableOpacity
                style={styles.credCloseBtn}
                onPress={() => setActivationModalVisible(false)}
                disabled={isActivating}
              >
                <Text style={styles.credCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.activationTargetEmailBox}>
              <Text style={styles.activationTargetEmailLabel}>Tài khoản Gmail:</Text>
              <Text style={styles.activationTargetEmailText}>{activationEmail}</Text>
            </View>

            <View style={styles.credInputGroup}>
              <Text style={styles.credInputLabel}>NHẬP MÃ KÍCH HOẠT (6 CHỮ SỐ)</Text>
              <TextInput
                style={styles.activationCodeInput}
                placeholder="000000"
                placeholderTextColor="#64748B"
                value={activationCode}
                onChangeText={(text) => setActivationCode(text.replace(/[^0-9]/g, '').slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
              />
            </View>

            <TouchableOpacity
              style={[styles.activationSubmitBtn, isActivating && { opacity: 0.7 }]}
              onPress={handleConfirmActivation}
              disabled={isActivating || isResending}
              activeOpacity={0.85}
            >
              {isActivating ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.activationSubmitText}>Xác nhận & Vào ứng dụng ngay ›</Text>
              )}
            </TouchableOpacity>

            {/* Nút gửi lại mã trực tiếp về Gmail */}
            <TouchableOpacity
              style={styles.activationResendBtn}
              onPress={handleResendActivationCodeFromModal}
              disabled={isActivating || isResending}
              activeOpacity={0.7}
            >
              {isResending ? (
                <ActivityIndicator size="small" color="#38BDF8" />
              ) : (
                <Text style={styles.activationResendText}>
                  📩 Chưa nhận được mã? Gửi lại mã vào Gmail
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.activationCancelBtn}
              onPress={() => setActivationModalVisible(false)}
              disabled={isActivating || isResending}
            >
              <Text style={styles.activationCancelText}>Hủy / Đóng</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── CỬA SỔ ĐĂNG KÝ TÀI KHOẢN GMAIL MỚI (GỬI DUYỆT ADMIN) ── */}
      <Modal
        visible={isRegModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!isRegistering) setRegModalVisible(false);
        }}
      >
        <View style={styles.credModalOverlay}>
          <View style={styles.regCard}>
            <View style={styles.credModalHeader}>
              <View style={{ flex: 1 }}>
                <View style={styles.regBadge}>
                  <Text style={styles.regBadgeText}>📝 ĐĂNG KÝ SỬ DỤNG CAREDROP</Text>
                </View>
                <Text style={styles.regTitle}>Đăng ký Gmail mới</Text>
                <Text style={styles.regSubtitle}>
                  Yêu cầu sẽ được gửi tới Quản trị viên để xét duyệt. Sau khi được duyệt, mã kích hoạt sẽ gửi về Gmail của bạn.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.credCloseBtn}
                onPress={() => setRegModalVisible(false)}
                disabled={isRegistering}
              >
                <Text style={styles.credCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
              {/* Họ và tên */}
              <View style={styles.credInputGroup}>
                <Text style={styles.credInputLabel}>HỌ VÀ TÊN *</Text>
                <TextInput
                  style={styles.credInput}
                  placeholder="Ví dụ: Nguyễn Văn An"
                  placeholderTextColor="#64748B"
                  value={regFullName}
                  onChangeText={setRegFullName}
                  editable={!isRegistering}
                />
              </View>

              {/* Gmail */}
              <View style={styles.credInputGroup}>
                <Text style={styles.credInputLabel}>ĐỊA CHỈ GMAIL *</Text>
                <TextInput
                  style={styles.credInput}
                  placeholder="emailcuaban@gmail.com"
                  placeholderTextColor="#64748B"
                  value={regEmail}
                  onChangeText={setRegEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  editable={!isRegistering}
                />
              </View>

              {/* Số điện thoại */}
              <View style={styles.credInputGroup}>
                <Text style={styles.credInputLabel}>SỐ ĐIỆN THOẠI (TÙY CHỌN)</Text>
                <TextInput
                  style={styles.credInput}
                  placeholder="Ví dụ: 0912345678"
                  placeholderTextColor="#64748B"
                  value={regPhone}
                  onChangeText={setRegPhone}
                  keyboardType="phone-pad"
                  editable={!isRegistering}
                />
              </View>

              {/* Phân quyền vai trò sử dụng */}
              <View style={styles.credInputGroup}>
                <Text style={styles.credInputLabel}>CHỌN PHÂN QUYỀN SỬ DỤNG *</Text>
                <View style={styles.regRolePickerRow}>
                  {/* Option 1: Người giám sát */}
                  <TouchableOpacity
                    style={[
                      styles.regRoleOption,
                      regRole === 'supervisor' && styles.regRoleOptionActiveSupervisor,
                    ]}
                    onPress={() => setRegRole('supervisor')}
                    activeOpacity={0.8}
                    disabled={isRegistering}
                  >
                    <Text style={styles.regRoleOptionIcon}>👁️</Text>
                    <Text
                      style={[
                        styles.regRoleOptionTitle,
                        regRole === 'supervisor' && styles.regRoleOptionTitleActiveSupervisor,
                      ]}
                    >
                      Người giám sát
                    </Text>
                    <Text style={styles.regRoleOptionDesc}>
                      Theo dõi người thân & nhận cảnh báo té ngã
                    </Text>
                  </TouchableOpacity>

                  {/* Option 2: Người được giám sát */}
                  <TouchableOpacity
                    style={[
                      styles.regRoleOption,
                      regRole === 'monitored_person' && styles.regRoleOptionActiveMonitored,
                    ]}
                    onPress={() => setRegRole('monitored_person')}
                    activeOpacity={0.8}
                    disabled={isRegistering}
                  >
                    <Text style={styles.regRoleOptionIcon}>🛡️</Text>
                    <Text
                      style={[
                        styles.regRoleOptionTitle,
                        regRole === 'monitored_person' && styles.regRoleOptionTitleActiveMonitored,
                      ]}
                    >
                      Người được giám sát
                    </Text>
                    <Text style={styles.regRoleOptionDesc}>
                      Sử dụng thiết bị đeo ESP32 & báo động té ngã
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Thông báo cam kết về phân quyền không được tự đổi */}
              <View style={styles.regRoleNoticeBox}>
                <Text style={styles.regRoleNoticeIcon}>⚠️</Text>
                <Text style={styles.regRoleNoticeText}>
                  <Text style={{ fontWeight: '800', color: '#F59E0B' }}>LƯU Ý VỀ PHÂN QUYỀN: </Text>
                  Sau khi đăng ký, phân quyền tài khoản sẽ được cố định và không thể tự thay đổi trong app. Bạn chỉ có thể liên hệ Quản trị viên để thay đổi phân quyền.
                </Text>
              </View>
            </ScrollView>

            {/* Nút gửi yêu cầu đăng ký */}
            <TouchableOpacity
              style={[styles.regSubmitBtn, isRegistering && { opacity: 0.7 }]}
              onPress={handleRegisterSubmit}
              disabled={isRegistering}
              activeOpacity={0.85}
            >
              {isRegistering ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.regSubmitText}>Gửi yêu cầu đăng ký cho Quản trị viên ›</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.activationCancelBtn}
              onPress={() => setRegModalVisible(false)}
              disabled={isRegistering}
            >
              <Text style={styles.activationCancelText}>Hủy / Đóng</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: SPACING.xl,
    paddingTop: 64,
    paddingBottom: 32,
    justifyContent: 'center',
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  appIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  appIcon: {
    fontSize: 32,
  },
  appTitle: {
    fontSize: FONT.xxl,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  appSubtitle: {
    fontSize: FONT.xs,
    color: 'rgba(255, 255, 255, 0.65)',
    marginTop: 4,
    textAlign: 'center',
  },

  // Google Card
  googleCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 28,
    width: '100%',
  },
  googleGLogoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  googleGLogo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EA4335',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleGText: {
    fontSize: 26,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  googleVerifiedBadge: {
    backgroundColor: '#E8F0FE',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  googleVerifiedText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0B57D0',
  },
  cardTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1F1F1F',
    marginBottom: 6,
  },
  cardSubtitle: {
    fontSize: 14,
    color: '#444746',
    lineHeight: 20,
    marginBottom: 20,
  },
  securityBox: {
    flexDirection: 'row',
    backgroundColor: '#F8F9FA',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E8EAED',
    marginBottom: 24,
  },
  securityBoxIcon: {
    fontSize: 22,
    marginRight: 10,
    marginTop: 2,
  },
  securityBoxContent: {
    flex: 1,
  },
  securityBoxTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1F1F1F',
    marginBottom: 2,
  },
  securityBoxText: {
    fontSize: 12,
    color: '#5F6368',
    lineHeight: 16,
  },

  // Main Google button
  googleMainBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B57D0',
    borderRadius: 28,
    paddingVertical: 14,
    paddingHorizontal: 20,
    ...SHADOW.md,
  },
  googleBtnIconBox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  googleBtnG: {
    fontSize: 16,
    fontWeight: '900',
    color: '#EA4335',
  },
  googleMainBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  guaranteeText: {
    textAlign: 'center',
    fontSize: 11,
    color: '#747775',
    marginTop: 16,
  },

  // Google Footer
  googleFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 28,
    paddingHorizontal: 6,
  },
  footerLanguage: {
    fontSize: 12,
    color: '#8E918F',
  },
  footerLinks: {
    flexDirection: 'row',
    gap: 16,
  },
  footerLinkItem: {
    fontSize: 12,
    color: '#8E918F',
  },

  // Web Modal
  webModalRoot: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  webModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'android' ? 44 : 52,
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E2E0',
  },
  webModalCloseBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  webModalCloseText: {
    fontSize: 14,
    color: '#5F6368',
    fontWeight: '600',
  },
  webModalTitleWrap: {
    alignItems: 'center',
  },
  webModalHeaderTitle: {
    fontSize: 13,
    color: '#1F1F1F',
    fontWeight: '700',
  },
  webModalHeaderSubtitle: {
    fontSize: 10,
    color: '#747775',
    marginTop: 1,
  },
  webModalDoneBtn: {
    backgroundColor: '#E8F0FE',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D3E3FD',
  },
  webModalDoneText: {
    fontSize: 13,
    color: '#0B57D0',
    fontWeight: '700',
  },
  authOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    zIndex: 999,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  authOverlayTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F1F1F',
    marginTop: 16,
  },
  authOverlayEmail: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0B57D0',
    marginTop: 6,
  },
  authOverlaySubtitle: {
    fontSize: 13,
    color: '#5F6368',
    marginTop: 6,
  },
  webLoadingWrap: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  webLoadingText: {
    marginTop: 12,
    fontSize: 13,
    color: '#5F6368',
  },
  webBottomBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#F8F9FA',
    borderTopWidth: 1,
    borderTopColor: '#E0E2E0',
  },
  webBottomBarText: {
    fontSize: 11,
    color: '#5F6368',
    textAlign: 'center',
    lineHeight: 16,
  },

  // Credential Login Button & Modal
  credLoginBtn: {
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
  },
  credLoginBtnText: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '600',
  },
  credModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  credModalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  credModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  credModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  credModalSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  credCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  credCloseText: {
    color: '#CBD5E1',
    fontSize: 16,
    fontWeight: '700',
  },
  adminChip: {
    backgroundColor: 'rgba(0, 122, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(0, 122, 255, 0.3)',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  adminChipText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  credInputGroup: {
    marginBottom: 14,
  },
  credInputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  credInput: {
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 14,
    fontSize: 14,
    color: '#FFFFFF',
  },
  credSubmitBtn: {
    backgroundColor: '#007AFF',
    borderRadius: 14,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  credSubmitText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  activationCard: {
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    width: '100%',
    maxWidth: 400,
  },
  activationBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  activationBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#F59E0B',
    letterSpacing: 0.5,
  },
  activationTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  activationSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 4,
    lineHeight: 18,
  },
  activationTargetEmailBox: {
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  activationTargetEmailLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
    marginBottom: 2,
  },
  activationTargetEmailText: {
    fontSize: 14,
    color: '#38BDF8',
    fontWeight: '700',
  },
  activationCodeInput: {
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderWidth: 2,
    borderColor: '#38BDF8',
    borderRadius: 14,
    height: 56,
    paddingHorizontal: 16,
    fontSize: 24,
    letterSpacing: 8,
    color: '#FFFFFF',
    textAlign: 'center',
    fontWeight: '800',
  },
  activationSubmitBtn: {
    backgroundColor: '#059669',
    borderRadius: 14,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  activationSubmitText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  activationResendBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  activationResendText: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '700',
  },
  activationCancelBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    paddingVertical: 6,
  },
  activationCancelText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },

  // Login Divider
  loginDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 14,
  },
  loginDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  loginDividerText: {
    marginHorizontal: 12,
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 1,
  },

  // Register Account Button
  registerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 14,
    height: 52,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 8,
  },
  registerBtnIcon: {
    fontSize: 16,
  },
  registerBtnText: {
    color: '#38BDF8',
    fontSize: 15,
    fontWeight: '700',
  },

  // Activate with Code Link
  activateCodeLink: {
    marginTop: 10,
    alignItems: 'center',
    paddingVertical: 4,
  },
  activateCodeLinkText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },

  // Registration Modal Card
  regCard: {
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
  },
  regBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.4)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  regBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#38BDF8',
    letterSpacing: 0.5,
  },
  regTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  regSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 4,
    lineHeight: 18,
  },
  regRolePickerRow: {
    flexDirection: 'row',
    gap: 10,
  },
  regRoleOption: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
  },
  regRoleOptionActiveSupervisor: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
  },
  regRoleOptionActiveMonitored: {
    borderColor: '#10B981',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
  },
  regRoleOptionIcon: {
    fontSize: 24,
    marginBottom: 6,
  },
  regRoleOptionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 4,
  },
  regRoleOptionTitleActiveSupervisor: {
    color: '#38BDF8',
  },
  regRoleOptionTitleActiveMonitored: {
    color: '#10B981',
  },
  regRoleOptionDesc: {
    fontSize: 10,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 14,
  },
  regRoleNoticeBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderRadius: 12,
    padding: 12,
    marginVertical: 12,
    alignItems: 'flex-start',
    gap: 8,
  },
  regRoleNoticeIcon: {
    fontSize: 16,
    marginTop: 1,
  },
  regRoleNoticeText: {
    flex: 1,
    fontSize: 11,
    color: '#CBD5E1',
    lineHeight: 16,
  },
  regSubmitBtn: {
    backgroundColor: '#0284C7',
    borderRadius: 14,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  regSubmitText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
