# CareDrop - Hệ Thống Cảnh Báo Té Ngã & Giám Sát Sức Khỏe Thông Minh

Tài liệu lưu đồ hoạt động hệ thống CareDrop được thiết kế theo tỷ lệ **chuẩn hóa cho báo cáo Word / Đồ án**:
* Kích thước mỗi sơ đồ **thu gọn vừa vặn trong 1 trang Word** (khoảng 1/2 đến 2/3 trang A4).
* Phông chữ to, nét đậm, chữ ít và cô đọng giúp **chụp màn hình dán vào Word không bị mờ hay chữ bé xíu**.
* Đầy đủ 100% chức năng của **3 phân quyền** (*Quản trị viên, Người giám sát, Người được giám sát*) và sự tương tác giữa các bên.
* Toàn bộ sơ đồ sử dụng văn bản thuần túy, không chèn biểu tượng/icon để đảm bảo tính trang trọng trong văn bản báo cáo.

---

## 1. Kiến Trúc Khối & Điều Hướng Hệ Thống (Architecture & Navigation)

Lưu đồ kiến trúc phân khối chức năng và cơ chế tương tác giữa Giao diện, Quản lý trạng thái, Dịch vụ nền và Cơ sở dữ liệu:

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'fontSize': '15px' }}}%%
flowchart TD
    subgraph UI_BLOCK ["KHỐI GIAO DIỆN VÀ ĐIỀU HƯỚNG"]
        NAV["<b>ĐIỀU HƯỚNG</b><br/>App.tsx / AppNavigator"] -- "hiển thị" --> SCREENS["<b>MÀN HÌNH VÀ HỘP THOẠI</b><br/>Admin • Giám sát • Người được giám sát"]
    end

    subgraph STATE_BLOCK ["KHỐI QUẢN LÍ TRẠNG THÁI"]
        AUTH["<b>PHIÊN VÀ VAI TRÒ</b><br/>AuthContext"]
        DEV["<b>THIẾT BỊ GIÁM SÁT</b><br/>DeviceContext"]
    end

    subgraph SERVICE_APP ["KHỐI DỊCH VỤ"]
        DATA_SVC["<b>DỮ LIỆU, LỊCH SỬ VÀ THÔNG BÁO</b><br/>alarmService • notificationService"]
    end

    subgraph SERVICE_BG ["KHỐI DỊCH VỤ"]
        BRIDGE["<b>CẦU NỐI VỚI ỨNG DỤNG</b><br/>CareDropBridgeModule"]
        BG["<b>GIÁM SÁT NỀN</b><br/>FallMonitoringService"]
        BRIDGE --> BG
    end

    FS["<b>DỮ LIỆU FIRESTORE</b><br/>Cloud Firestore"]

    NAV -- "phiên" --> AUTH
    NAV -- "state" --> DEV
    DEV -- "gọi server" --> DATA_SVC

    DATA_SVC --> BRIDGE
    BG <--> FS
    DATA_SVC <--> FS

    style UI_BLOCK fill:#fcfcfc,stroke:#333333,stroke-width:1.5px,stroke-dasharray: 5 5
    style STATE_BLOCK fill:#fcfcfc,stroke:#333333,stroke-width:1.5px,stroke-dasharray: 5 5
    style SERVICE_APP fill:#fcfcfc,stroke:#333333,stroke-width:1.5px,stroke-dasharray: 5 5
    style SERVICE_BG fill:#fcfcfc,stroke:#333333,stroke-width:1.5px,stroke-dasharray: 5 5
    style FS fill:#ffffff,stroke:#333333,stroke-width:1.5px
```

### 1.1. Chi Tiết Phân Luồng 3 Vai Trò Người Dùng

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'fontSize': '15px' }}}%%
flowchart TD
    A["<b>KHỞI ĐỘNG ỨNG DỤNG</b><br/>AuthContext"] --> B{"<b>KIỂM TRA PHIÊN</b>"}

    B -- "Chưa đăng nhập / Chưa OTP" --> C1["<b>ĐĂNG NHẬP / ĐĂNG KÝ</b><br/>GoogleLoginScreen"]
    B -- "Quyền Quản trị viên" --> C2["<b>QUẢN TRỊ VIÊN</b><br/>AdminScreen"]
    B -- "Quyền Người được giám sát" --> C3["<b>NGƯỜI ĐƯỢC GIÁM SÁT</b><br/>MonitoredScreen"]
    B -- "Quyền Người giám sát" --> C4["<b>NGƯỜI GIÁM SÁT</b><br/>AppNavigator (4 Tabs)"]

    style A fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style B fill:#fff9c4,stroke:#fbc02d,stroke-width:2px
    style C1 fill:#f5f5f5,stroke:#757575,stroke-width:1.5px
    style C2 fill:#ede7f6,stroke:#512da8,stroke-width:1.5px
    style C3 fill:#fffde7,stroke:#fbc02d,stroke-width:1.5px
    style C4 fill:#e1f5fe,stroke:#0288d1,stroke-width:1.5px
```

---

## 2. Tương Tác 3 Phân Quyền: Quy Trình Đăng Ký & Phê Duyệt

Luồng tương tác xác thực email bảo mật giữa Người dùng, Quản trị viên và Dịch vụ Email:

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'fontSize': '15px' }}}%%
flowchart TD
    subgraph P1 ["1. ĐĂNG KÝ TÀI KHOẢN"]
        U1["<b>NGƯỜI DÙNG</b><br/>Nhập Email, SĐT, Chọn quyền"] --> S1["<b>FIRESTORE</b><br/>Lưu: pending_approval"]
    end

    subgraph P2 ["2. QUẢN TRỊ VIÊN XÉT DUYỆT"]
        S1 --> A1["<b>ADMIN SCREEN</b><br/>Kiểm tra thông tin & Vai trò"]
        A1 --> A2{"<b>DUYỆT?</b>"}
        A2 -- "Từ chối" --> A3["<b>HỦY YÊU CẦU</b><br/>Xóa khỏi CSDL"]
        A2 -- "Đồng ý" --> A4["<b>PHÊ DUYỆT</b><br/>Lệnh cấp mã OTP"]
    end

    subgraph P3 ["3. XÁC THỰC GMAIL & KÍCH HOẠT"]
        A4 --> S2["<b>HỆ THỐNG GMAIL</b><br/>Gửi OTP 6 số (hạn 15 phút)"]
        S2 --> U2["<b>NHẬP MÃ OTP</b><br/>Nhập mã nhận từ Gmail"]
        U2 --> S3{"<b>ĐÚNG MÃ?</b>"}
        S3 -- "Sai" --> U2
        S3 -- "Đúng" --> U3["<b>KÍCH HOẠT THÀNH CÔNG</b><br/>Chuyển active • Vào app"]
    end

    style P1 fill:#e8f5e9,stroke:#388e3c,stroke-width:1.5px
    style P2 fill:#ede7f6,stroke:#512da8,stroke-width:1.5px
    style P3 fill:#e1f5fe,stroke:#0288d1,stroke-width:1.5px
    style A2 fill:#fff9c4,stroke:#fbc02d,stroke-width:1.5px
    style S3 fill:#fff9c4,stroke:#fbc02d,stroke-width:1.5px
    style U3 fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px
    style A3 fill:#ffcdd2,stroke:#c62828,stroke-width:1.5px
```

---

## 3. Quản Lý Thiết Bị, Tiếp Nhận Cảnh Báo Té Ngã & Xử Lý Khẩn Cấp

Lưu đồ xử lý chính khi ứng dụng hoạt động (Hình 3.10 - Quản lý thiết bị, vòng đời đăng ký và cập nhật cảnh báo):

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'fontSize': '15px' }}}%%
flowchart TD
    subgraph G1 ["1. QUẢN LÝ GHÉP NỐI & ĐĂNG KÝ DỮ LIỆU"]
        DEV_ACT["<b>THÊM / BỎ GHÉP THIẾT BỊ</b><br/>Lưu danh sách theo tài khoản"] --> SUB_ON["<b>ĐĂNG KÝ THEO DÕI TÀI LIỆU</b><br/>Lắng nghe trạng thái trên Firestore"]
    end

    subgraph G2 ["2. TIẾP NHẬN & DIỄN GIẢI BẢN CẬP NHẬT"]
        HW["<b>CẢM BIẾN ESP32</b><br/>Gửi dữ liệu ngã / Pin thấp"] --> FB["<b>FIRESTORE REALTIME</b><br/>Đẩy bản cập nhật trạng thái"]
        SUB_ON --> FB
        FB --> DM["<b>BỘ QUẢN LÝ THIẾT BỊ</b><br/>Giữ riêng từng mã • Lọc chống lặp"]
        NOTIF["<b>THÔNG BÁO ANDROID</b><br/>Chạm thông báo chạy ngầm"] -.-> DM
    end

    subgraph G3 ["3. KÍCH HOẠT BÁO ĐỘNG & XÁC NHẬN"]
        DM --> CHK{"<b>PHÁT HIỆN<br/>SỰ CỐ?</b>"}
        CHK -- "Té ngã / Pin yếu" --> ALARM["<b>PHÁT ÂM BÁO & MỞ HỘP THOẠI</b><br/>Chọn thiết bị • Hiện FallAlertModal"]
        ALARM --> ACK_S["<b>XÁC NHẬN CỨU HỘ</b><br/>Bấm 'Đã kiểm tra / Tắt cảnh báo'"]
        
        M_SIDE["<b>PHÍA NGƯỜI ĐƯỢC GIÁM SÁT</b><br/>Còi hú to • Bấm 'Tôi ổn'"]
        
        ACK_S ==> SYNC["<b>TẮT BÁO ĐỘNG & ĐỒNG BỘ</b><br/>Tắt âm điện thoại • Cập nhật cờ Firestore"]
        M_SIDE ==> SYNC
    end

    style G1 fill:#e8f5e9,stroke:#388e3c,stroke-width:1.5px
    style G2 fill:#e1f5fe,stroke:#0288d1,stroke-width:1.5px
    style G3 fill:#fff3e0,stroke:#e65100,stroke-width:1.5px
    style HW fill:#ffebee,stroke:#c62828,stroke-width:2px
    style FB fill:#fff8e1,stroke:#ffa000,stroke-width:2px
    style NOTIF fill:#f3e5f5,stroke:#7b1fa2,stroke-width:1.5px
    style SYNC fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style CHK fill:#fff9c4,stroke:#fbc02d,stroke-width:1.5px
```

---

## 4. Lưu Đồ Hoạt Động Chi Tiết Của Từng Phân Quyền

### 4.1. Nghiệp Vụ Quản Trị Viên (Admin)

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'fontSize': '15px' }}}%%
flowchart TD
    A0["<b>MÀN HÌNH QUẢN TRỊ</b><br/>AdminScreen"] --> A1{"<b>CHỌN TÁC VỤ</b>"}

    subgraph TAB1 ["DUYỆT ĐĂNG KÝ"]
        B1["<b>YÊU CẦU CHỜ DUYỆT</b><br/>Email, SĐT, Phân quyền"]
        B2["<b>PHÊ DUYỆT</b><br/>Gửi mã OTP Gmail"]
        B3["<b>TỪ CHỐI</b><br/>Hủy tài khoản"]
        B1 --> B2 & B3
    end

    subgraph TAB2 ["QUẢN LÝ TÀI KHOẢN"]
        C1["<b>DANH SÁCH USER</b><br/>Xem tất cả tài khoản"]
        C2["<b>KHÓA / MỞ KHÓA</b><br/>Chặn hoặc mở quyền"]
        C3["<b>ĐỔI VAI TRÒ</b><br/>Giám sát ⇄ Được giám sát"]
        C4["<b>GỬI LẠI MÃ / XÓA</b><br/>Cấp lại OTP hoặc xóa hẳn"]
        C1 --> C2 & C3 & C4
    end

    A1 --> TAB1
    A1 --> TAB2

    style A0 fill:#ede7f6,stroke:#512da8,stroke-width:2px
    style TAB1 fill:#f3e5f5,stroke:#7b1fa2,stroke-width:1.5px
    style TAB2 fill:#ede7f6,stroke:#512da8,stroke-width:1.5px
```

---

### 4.2. Nghiệp Vụ Người Giám Sát (Supervisor)

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'fontSize': '15px' }}}%%
flowchart TD
    S0["<b>DASHBOARD GIÁM SÁT</b><br/>Chạy ngầm 24/7 (FallMonitoringService)"] --> S_TAB{"<b>CHỨC NĂNG</b>"}

    subgraph G1 ["THEO DÕI SỨC KHỎE"]
        D1["<b>CHỈ SỐ SỨC KHỎE</b><br/>Nhịp tim, SpO2, Pin, Kết nối"]
        D2["<b>QUẢN LÝ NGƯỜI THÂN</b><br/>Chọn / thêm thiết bị ghép nối"]
        D1 --- D2
    end

    subgraph G2 ["CỨU NẠN & LỊCH SỬ"]
        M1["<b>BẢN ĐỒ ĐỊNH VỊ</b><br/>Tọa độ GPS & Chỉ đường nhanh"]
        M2["<b>CÒI HÚ & TẮT CẢNH BÁO</b><br/>Chuông to liên tục • Bấm tắt"]
        M3["<b>LỊCH SỬ SỰ CỐ</b><br/>Nhật ký các lần ngã trước"]
        M1 --- M2 --- M3
    end

    S_TAB --> G1
    S_TAB --> G2

    style S0 fill:#e1f5fe,stroke:#0288d1,stroke-width:2px
    style G1 fill:#e0f7fa,stroke:#00838f,stroke-width:1.5px
    style G2 fill:#ffebee,stroke:#c62828,stroke-width:1.5px
```

---

### 4.3. Nghiệp Vụ Người Được Giám Sát (Monitored Person)

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'fontSize': '15px' }}}%%
flowchart TD
    M0["<b>GIAO DIỆN NGƯỜI ĐƯỢC GIÁM SÁT</b><br/>MonitoredScreen"] --> M_CHECK{"<b>THIẾT BỊ?</b>"}

    subgraph DEV ["ĐĂNG KÝ PHẦN CỨNG"]
        E1["<b>NHẬP MÃ ESP32</b><br/>Ví dụ: ESP32_FALL_001"]
        E2["<b>GHÉP 1 THIẾT BỊ DUY NHẤT</b><br/>Lưu mã vào tài khoản"]
        E3["<b>ĐỔI THIẾT BỊ MỚI</b><br/>Xóa mã cũ & Ghép mã mới"]
        E1 --> E2 --> E3
    end

    subgraph RUN ["THEO DÕI & BÁO ĐỘNG TẠI CHỖ"]
        R1["<b>CHẠY NGẦM 24/7</b><br/>Duy trì kết nối nền & Pin"]
        R2["<b>BÁO ĐỘNG TÉ NGÃ</b><br/>Hú còi to tại chỗ + Rung"]
        R3["<b>XÁC NHẬN 'TÔI ỔN'</b><br/>Tắt còi nếu an toàn"]
        R1 --> R2 --> R3
    end

    M_CHECK -- "Chưa ghép" --> DEV
    M_CHECK -- "Đã kết nối" --> RUN

    style M0 fill:#fffde7,stroke:#fbc02d,stroke-width:2px
    style DEV fill:#fff8e1,stroke:#ffa000,stroke-width:1.5px
    style RUN fill:#ffebee,stroke:#d84315,stroke-width:1.5px
```

---

## 5. Bảng Tóm Tắt Phân Quyền & Tính Năng

| Tính năng chính | Quản trị viên (Admin) | Người giám sát (Supervisor) | Người được giám sát (Monitored) |
| :--- | :---: | :---: | :---: |
| **Phê duyệt & Kích hoạt qua Gmail** | Toàn quyền | Không | Không |
| **Khóa / Mở khóa / Đổi phân quyền** | Toàn quyền | Không | Không |
| **Đăng ký phần cứng ESP32** | Không | Không | Có (Duy nhất 1 thiết bị, có thể đổi) |
| **Theo dõi nhiều người thân** | Có | Có | Không |
| **Chuông báo thức liên tục khi ngã** | Không | Có (Còi hú + Rung) | Có (Còi hú + Rung tại chỗ) |
| **Định vị bản đồ & Dẫn đường GPS** | Không | Có | Không |
| **Tắt cảnh báo sự cố** | Không | Có (Đã kiểm tra) | Có (Nút 'Tôi ổn') |
| **Chạy ngầm 24/7 (Foreground Service)** | Không | Có | Có |
