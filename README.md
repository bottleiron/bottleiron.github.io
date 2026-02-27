# 슈가게부 (SugarGebu) 💰✨

**슈가게부**는 서버와 빌드 과정(Webpack, Vite 등) 없이 오직 순수 HTML, CSS, JavaScript로 구동되는 **No-Build PWA(Progressive Web App)** 가계부입니다. 
데이터는 GitHub Repository를 무료 데이터베이스처럼 활용하며, 구글의 AI 제미나이(Gemini)를 도입해 지출 내역을 똑똑하게 대화형으로 관리하고 검색할 수 있습니다.

---

## 🚀 1. 핵심 아키텍처 (Architecture)

### 1) No-Build & 모듈 시스템 (ES Modules)
과거의 무거운 `node_modules`와 `package.json`을 모두 버리고 브라우저 기본 기능만 사용합니다.
- `index.html`에서 `<script type="importmap">`을 사용하여 CDN(`esm.sh`)을 통해 외부 라이브러리(`@octokit/rest`, `uuid`)를 직접 가져옵니다.
- JS 로직을 기능별로 분리(`app.js`, `auth.js`, `github-api.js`)하여 `type="module"`로 깔끔하게 불러옵니다.

### 2) GitHub as a Database (무료 DB)
서버(백엔드) 없이, 사용자의 GitHub Private Repository 특정 폴더(`data/YYYY/MM/YYYY-MM-DD.json`)에 일별 가계부 데이터를 JSON 파일 형태로 직접 기록하고 읽어옵니다.

### 3) PWA (Progressive Web App) 달성
스마트폰이나 PC에 마치 네이티브 앱처럼 설치가 가능합니다.
- **`manifest.json`**: 앱의 이름, 테마 색상, 아이콘을 정의합니다.
- **`sw.js` (서비스 워커)**: `Cache First` 전략으로 폰트, CSS, HTML 등 껍데기(App Shell)를 오프라인에서도 즉시 로드하고, 실제 데이터 통신(GitHub API)은 캐시를 우회하도록 완벽히 분기했습니다.

---

## 💡 2. 주요 로직 깊어보기 (Deep Dive)

### [A] 완벽한 오프라인 전환: All-in-Memory & IndexedDB 캐싱
앱을 켤 때마다 매번 몇 년 치의 데이터를 로드하면 너무 느리고 API 한도(Rate Limit)에 걸립니다.
1. **최초 접속**: GitHub의 `data/` 전체 폴더 트리를 한 번에 순회하여 모든 연/월의 데이터를 하나의 배열(`app.allLedgerData`)로 통합합니다.
2. **IndexedDB 저장**: 합쳐진 방대한 데이터를 브라우저 내장 DB인 `IndexedDB`에 영구 캐싱합니다. (`localStorage`의 5MB 용량 한계 극복)
3. **재접속 최적화**: 다음부터는 `IndexedDB`에서 0.1초 만에 전 기수 데이터를 불러와 화면(달력, 대시보드)을 그리므로 구동 속도가 압도적으로 빠릅니다.

### [B] 안전한 수동 동기화 큐 (Sync Queue)
데이터를 입력할 때마다 GitHub에 업로드하면 충돌이나 지연이 발생합니다.
1. 지출 내역을 입력/수정/삭제하면 즉시 메모리에 반영하여 화면은 바뀌지만, 원격 통신은 하지 않고 브라우저 큐(`syncQueue`)에 차곡차곡 모아둡니다 (`ID`와 행동 `_action:` 기록).
2. 사용자가 원할 때 **[동기화]** 버튼을 누르면, 큐에 쌓인 변경사항들만 날짜별 파일 경로로 묶어(`github-api.js`) 원격에 병합(Merge & Commit)하여 저장합니다.

### [C] 극한의 토큰 다이어트: 3단계 스마트 RAG (AI 검색)
제미나이 AI에게 수년 치 가계부 내역 전체를 보내면 **"API 요금 폭탄"** 및 **"산수 오류"** 늪에 빠지게 됩니다. 
이를 막기 위해 AI 요청을 3단계로 고도화했습니다.

*   **Step 1. 의도 추출 (Intent Analysis)**: 
    사용자가 질문하면 데이터 없이 텍스트만 먼저 보내어 "년도/월, 식비" 등의 검색 조건 파라미터만 뽑아옵니다. (ex: `{"intent": "INQUIRY", "data": {"date_prefix": "2025", "category": "식비"}}`)
*   **Step 2. JS 자체 연산 (Reduce)**: 
    총 지출 합산 등 통계를 물어보는 `INQUIRY_SUMMARY` 인텐트의 경우, AI에게 덧셈을 시키지 않고 자바스크립트가 직접 `reduce`로 100% 정확하게 금액을 합산합니다.
*   **Step 3. 로컬 필터링 및 CSV 경량화 전송 (RAG)**: 
    거대한 IndexedDB 데이터 중 AI가 찾아준 조건에 맞는 데이터 2~30건만 브라우저가 직접 필터링합니다. 뽑아낸 데이터마저도 무거운 JSON 객체 `{}` 대신 **콤마로 구분된 초경량 CSV** 문자열로 돌돌 압축하여 최종 AI에게 전송하므로 답변 속도는 폭발적으로 늘고 토큰 비용은 사실상 `0`원에 가깝게 절약됩니다.

---

## 🔒 3. 보안 및 인증 (Security)
개인정보인 GitHub PAT(Personal Access Token)는 소스코드에 절대 저장되지 않습니다.
- 처음에 입력받은 토큰은 `auth.js` 모듈이 CryptoJS 라이브러리를 통해 암호화하여 브라우저의 휘발성 `sessionStorage`에 임시 보관합니다. 앱을 끄거나 탭을 닫으면 완전히 날아갑니다.

---

## 🛠️ 4. 디렉토리 구조 (Directory Structure)
```text
/
├── index.html           # 메인 애플리케이션 진입점 (UI/로직 모듈 로더)
├── style.css            # 전체 UI 컴포넌트, 컬러 팔레트 및 애니메이션 스타일링
├── manifest.json        # PWA 메타데이터 정의 파일
├── sw.js                # 오프라인 및 App Shell 캐싱을 전담하는 서비스 워커
│
└── /js                  # [ ES Module JavaScript 로직 ]
    ├── app.js           # 앱 상태 관리, IndexedDB 호출, UI 랜더링, AI(Gemini) RAG 제어
    ├── auth.js          # CryptoJS 토큰 암/복호화 및 PIN 번호 잠금화면, 인가 처리
    └── github-api.js    # Octokit 래퍼 클래스, GitHub 조회/동기화(생성/변경/삭제) 통신 전담 
```
