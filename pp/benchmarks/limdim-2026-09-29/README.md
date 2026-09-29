# Benchmark: limdim, 29/09/2026

Lần chạy thật đầu tiên của đội P/P trên một repo thật: `~/Documents/my-projects/limdim` (app Swift macOS/iOS có mascot
là giao diện chính). Supervisor kiêm product founder. Seatworks 3.0.0-dev.308 (fork `main-pp`), Paseo 0.9.2.

Nguồn số liệu: `~/.local/share/seatworks-v3/projects/limdim-73855d/` (`events.log`, `ledger.json`, `gates/`) và bản ghi
agent của Paseo. Không có số liệu token hay chi phí: Paseo không lưu theo agent.

## Kết quả

- **6/6 lane land lên `main`**, mỗi lane một commit squash. Tổng thời gian 4 giờ 29 phút (06:52–11:21 UTC).
- **Gate xanh ở mọi lần chạy trong lúc làm** (17/17 lần). Nhưng **`main` đỏ khi chạy lại lúc 23:16**: 4 test app của L4
  fail ổn định (`LookAwayTests`, lặp lại 2/2 lần). Nguyên nhân gần như chắc chắn: rig của test bắt đầu từ `Date()` rồi
  chạy mô phỏng hơn một giờ, nên chạy sau khoảng 23 giờ thì vượt nửa đêm. Lúc đó `AppModel.swift:623` reset số liệu
  trong ngày, và phép đếm lệch ("2" thay vì "3"). Gate L6 chạy lúc 18:20 nên không gặp. Chưa kiểm chứng bằng cách đổi
  đồng hồ.
- Package test tăng từ 215 lên 391; test app là 170.

| Lane | Việc | Thời gian | Task | Cut | Review (chấp nhận / sửa / mở lại) | Gate |
|---|---|---|---|---|---|---|
| L1 | Nghiên cứu: cách người ta làm việc, nghỉ, tắt thông báo; mascot và UI hợp Gen Z | 41 phút | 5 | 0 | – | 2 xanh |
| L2 | Đưa `integration/2026-09-26` (38 commit) về `main` | 26 phút | 3 | 1 | – | 3 xanh |
| L3 | Ẩn mọi thứ của Limdim khi chia sẻ hoặc ghi màn hình | 112 phút | 4 | 5 | 2 / 3 / 0 | 5 xanh |
| L4 | Mặc định nhẹ nhàng: pet mời nhìn ra xa, không khoá màn hình | 139 phút | 9 | 5 | 2 / 2 / 0 | 2 xanh |
| L5 | Giọng văn: bình thản, chữ thường, không như sếp hay huấn luyện viên | 83 phút | 6 | 4 | 0 / 2 / 1 | 3 xanh |
| L6 | "Focus with me" | 64 phút | 3 | 3 | 2 / 2 / 0 | 2 xanh |

L3, L4 và L5 chạy song song từ 07:58. L6 chờ ba lane đó land mới mở.

## Theo model

| Seat | Model | Số seat | Kết quả |
|---|---|---|---|
| Supervisor | Claude Opus 5.5 · high | 2 | 182 lần gọi desk |
| Lead | Claude Opus 5.5 · medium | 6 | 187 lần gọi desk |
| Peer | Claude Opus 5.5 · medium | 19 | 30 hand-back: 22 xong, 8 một phần |
| Peer Flash | OMP Gemini 3.8 Flash · high | 9 | 13 hand-back, đều xong (5 ở L1, 8 rải ở L3–L5) |
| Reviewer | Codex GPT-6 Sol · high | 16 | 16 review: 6 chấp nhận, 9 yêu cầu sửa, 1 mở lại |

Codex chỉ làm Reviewer. Yêu cầu sửa của nó dẫn tới rework thật ở L3, L4, L5 và L6.

## SLP có chạy đúng không

Có bằng chứng rõ cho các ý của bài SLP:

- **Supervisor đổi quyết định vì bằng chứng (A16).** Supervisor bảo giữ long break cho chế độ Gentle. Peer L4 chứng
  minh tiền đề sai (CONTEXT định nghĩa look-away là khoảng 20 giây; Balanced vốn không có long break). Supervisor viết
  "Your evidence shows that premise was wrong" và bỏ long break.
- **Peer chất vấn và Lead chọn phương án (A19).** Câu "time to look away" vi phạm luật giọng văn trên `main`. Peer đề
  xuất đổi thành "look-away time", Lead đồng ý và giữ nguyên luật.
- **Quyết định xuyên lane đi đúng người (A12 → A13).** Muốn phát hiện Teams, Slack huddle, Meet, FaceTime thì chỉ có
  một API riêng của Apple. Peer hỏi Lead, Lead đẩy lên Supervisor. Supervisor cho dùng, vì app phân phối trực tiếp chứ
  không qua App Store, và bắt thêm lối thoát khi báo nhầm.
- **Hỏi khi đề bài để ngỏ (A21).** Hỏi "dừng sớm" khác "dừng đủ" thế nào. Supervisor trả lời là không có khác biệt,
  và sửa tiêu chí nghiệm thu thành test ở cả 2 phút và 60 phút.

Tổng cộng có 21 ask nội bộ giữa Peer, Lead và Supervisor. Supervisor không gửi câu hỏi nào cho Human trong lúc chạy:
project ở chế độ "Human out of the loop", còn `CONTEXT.md` đã được chốt từ đầu.

## Chỗ tốn công

1. **Sandbox chặn build.** Seat không ghi được vào thư mục tạm của macOS (`/var/folders/.../T`), nên không chạy được
   `swift test`, `xcodegen`, `xcodebuild` hay render. Có 8 ask về chuyện này (A1, A2, A5–A8, A11, A14). Mỗi lane tự tìm
   đường vòng: `--disable-sandbox`, đổi `TMPDIR`, build tay bằng `swiftc`, hoặc đọc code rồi để gate build lần đầu. Đây
   là chỗ phí nhiều nhất.
2. **Watch quá ồn.** Có 212 phát hiện và 116 incident. Supervisor gọi `mark_incident` 116 lần, chiếm khoảng 64% số lần
   gọi desk của nó. Theo Better-SLP, watch cần chứng minh nó đáng giá.
3. **Test phụ thuộc giờ lọt qua review lẫn gate** (xem phần Kết quả). Reviewer đọc code chứ không chạy test lúc gần
   nửa đêm. Gate chỉ chạy một lần vào lúc land.

## Nên sửa

- **limdim:** cho rig trong `LookAwayTests` bắt đầu từ một giờ cố định (ví dụ 12:00), hoặc chạy test ở nhiều giờ trong
  ngày. Làm trước khi mở lane tiếp theo, vì `main` đang đỏ sau 23 giờ.
- **Seatworks:** cho seat ghi vào một `TMPDIR` riêng (hoặc cho phép `/var/folders/.../T`) khi project là Swift/Xcode.
  Thêm luật: phải chạy gate trên `main` sau khi land.
- **Đo tiếp:** chi phí token theo seat (hiện chưa có). Và xem watch có bắt được gì mà Lead hay Reviewer bỏ sót không.
  Nếu không thì giảm tần suất.

## Ảnh render

Trong `renders/` (chép từ bằng chứng của các lane): look-away ba kiểu của L4 (`gaze` là mặc định), menu khi chia sẻ màn
hình của L3, pet với giọng văn mới của L5, và thẻ cùng menu của "focus with me" ở L6.
