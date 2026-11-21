# TikTok PC Pro Toolkit (Chrome Extension - Manifest V3)

Tiện ích mở rộng chuyên dụng cho **TikTok PC Web**, bổ sung các tính năng nâng cao bị thiếu trên phiên bản máy tính.

---

## 🌟 Các tính năng chính

1. **👻 Ghost Story Viewer (Xem Story ẩn danh):**
   * Tự động chặn các gói tin tracking (`commit/item/view/`, telemetry) của TikTok.
   * Xem mọi story thoải mái mà chủ story hoàn toàn không thấy tên bạn trong danh sách viewer.
   * Có công tắc bật/tắt linh hoạt trong Popup.

2. **👁️ Story Stats Overlay (Hiển thị lượt xem thực tế):**
   * Tự động bóc tách trường `stats.playCount` (lượt xem), `stats.diggCount` (lượt thích) từ dữ liệu gốc API của TikTok.
   * Hiển thị Floating Badge đẹp mắt ngay trên Story Player (giống SnapTik).

3. **📥 Trình tải Media chuyên nghiệp (Không watermark & Toàn bộ ảnh ZIP):**
   * Tải video TikTok chất lượng cao nhất không logo.
   * Đối với bài viết nhiều ảnh (Carousel): Tự động gom toàn bộ ảnh gốc vào một file `.zip` bằng module `SimpleZip` thuần JS tải 1 click.
   * Tải Story trực tiếp.

4. **🛡️ Công cụ thay đổi trạng thái (Privacy Modifier):**
   * Cho phép chủ tài khoản nhập `ID bài viết / Video ID` và gửi yêu cầu đổi quyền riêng tư (Public $\leftrightarrow$ Friends $\leftrightarrow$ Only me) thông qua API Web từ phiên đăng nhập hiện tại trên PC.

---

## 🚀 Hướng dẫn cài đặt vào trình duyệt (Chrome / Edge / Cốc Cốc / Brave)

1. Mở trình duyệt và truy cập vào trang quản lý Extension:
   * **Chrome / Brave:** `chrome://extensions/`
   * **Edge:** `edge://extensions/`
   * **Cốc Cốc:** `coccoc://extensions/`
2. Bật công tắc **"Developer mode" (Chế độ dành cho nhà phát triển)** ở góc trên bên phải.
3. Bấm nút **"Load unpacked" (Tải tiện ích đã giải nén)** ở góc trên bên trái.
4. Chọn thư mục dự án: `D:\coding\TikTemp`.
5. Extension **TikTok PC Pro Toolkit** sẽ xuất hiện trên thanh tiện ích của bạn!

---

## 🛠️ Cấu trúc thư mục

```
D:\coding\TikTemp\
├── manifest.json              # Khai báo cấu hình Extension (Manifest V3)
├── background/
│   └── service-worker.js      # Điều phối tải file & rules chặn tracking view
├── content/
│   ├── injected.js            # Chạy ở MAIN world: Hook fetch/XHR đón raw stats & links
│   ├── content.js             # Chạy ở ISOLATED world: Render Stats Badge & nút tải
│   └── styles.css             # Giao diện Dark theme chuẩn TikTok
├── popup/
│   ├── popup.html             # Menu popup cài đặt
│   ├── popup.css              # Style hiện đại cho popup
│   └── popup.js               # Logic điều khiển cài đặt & đổi quyền riêng tư
├── utils/
│   └── zip-helper.js          # Bộ tạo file ZIP thuần JavaScript (Store mode)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```
