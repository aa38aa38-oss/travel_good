# 北海道最強導遊

2027/1/10–1/16 北海道行程的定位語音導覽網頁。走進景點範圍會跳出通知，按「播放」用八卦記者口吻唸導覽；「爆料台」可用關鍵字問問題。

- 純靜態網頁，不使用任何付費 API，也沒有後端。
- 地圖：Leaflet + OpenStreetMap（街道）/ Esri World Imagery（衛星），導航按鈕會開啟 Google Maps。
- 語音：手機瀏覽器內建的語音朗讀。
- 定位只在手機上運算，不會上傳。

## 檔案

| 檔案 | 內容 |
|---|---|
| `index.html`、`css/`、`js/app.js` | App 本體 |
| `js/data-a.js` | Day 1 札幌、Day 2 小樽的導覽稿 |
| `js/data-b.js` | Day 3 札幌、Day 4–5 滑雪、札幌口袋名單 |
| `js/data-c.js` | Day 6–7、每日摘要、搜尋題庫、待辦清單 |
| `sw.js`、`manifest.webmanifest` | 離線快取與「加入主畫面」 |

要改導覽內容，直接編輯 `js/data-*.js`，欄位說明在 `data-a.js` 開頭。

## 上線

網站必須用 HTTPS 才能定位。把整個資料夾部署到 Netlify 或 GitHub Pages 即可，不需要建置步驟。

## 本機預覽

```
python3 -m http.server 8765
```

開 `http://localhost:8765`，在設定裡打開「測試模式」，點地圖就能模擬走到景點。
