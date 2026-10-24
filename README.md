# FloatMemo

다른 프로그램(Microsoft Teams, 브라우저 등) **위에 항상 떠 있는** 데스크탑 메모장입니다.
Electron 으로 만들어져 Windows / macOS / Linux 에서 동작합니다.

## 기능

| 기능 | 사용 방법 |
| --- | --- |
| 항상 위에 표시 | 기본 켜짐. 📌 버튼으로 끄고 켤 수 있음 |
| 위치 이동 / 크기 조절 | 상단 바를 드래그해서 이동, 창 가장자리를 끌어 크기 조절 (위치·크기는 자동 저장) |
| 투명도 조절 | 상단 바의 슬라이더 (15% ~ 100%) 또는 `Ctrl+Shift+↑ / ↓` |
| 글씨 굵게 | **B** 버튼 또는 `Ctrl+B` |
| 토글 블록 (노션 스타일) | 줄 맨 앞에 `> ` 입력, ▸ 버튼, 또는 `Ctrl+Shift+T`. 화살표를 클릭하면 접기/펼치기 |
| 자동 저장 | 입력할 때마다 내용·접힘 상태·투명도·창 위치를 자동 저장, 다음 실행 시 복원 |
| 빠른 호출 | `Ctrl+Shift+M` (macOS: `Cmd+Shift+M`) 으로 어디서든 메모장 보이기/숨기기 |

### 토글 블록 조작

- 제목 줄에서 `Enter` → 토글 본문으로 이동
- 본문의 빈 마지막 줄에서 `Enter` → 토글 밖으로 나가기
- 비어 있는 토글 제목에서 `Backspace` → 일반 줄로 되돌리기
- 본문 첫 줄 맨 앞에서 `Backspace` → 제목 끝으로 이동

## 실행

```bash
npm install
npm start
```

## 설치 파일 만들기 (선택)

```bash
npm run dist
```

`dist/` 폴더에 Windows 는 설치 파일(NSIS)과 포터블 실행 파일, macOS 는 DMG, Linux 는 AppImage 가 생성됩니다.
Windows 설치 파일은 Windows 에서, macOS DMG 는 macOS 에서 빌드하는 것이 가장 안정적입니다.

## 테스트

```bash
npm test
```

Chromium(Playwright) 에서 에디터의 굵게 / 토글 생성·접기·탈출 / 붙여넣기 / 저장 동작을 검증합니다.
Playwright 가 없다면 `npm install -D playwright` 후 `npx playwright install chromium` 이 필요합니다.

## 알려진 제한

- **Linux**: Electron 이 창 투명도(`setOpacity`)를 지원하지 않아 슬라이더가 동작하지 않습니다. Windows / macOS 에서는 정상 동작합니다.
- 다른 프로그램이 **전체 화면(배타적 풀스크린)** 모드일 때는 운영체제 정책상 그 위에 뜨지 않을 수 있습니다. 일반 창·최대화 창 위에는 표시됩니다.
- 저장 위치: 운영체제의 앱 데이터 폴더 (`%APPDATA%\float-memo\state.json`, `~/Library/Application Support/float-memo/state.json`, `~/.config/float-memo/state.json`)

## 구조

```
src/
  main.js      Electron 메인 프로세스 (창 생성, 항상 위, 투명도, 상태 저장)
  preload.js   렌더러 ↔ 메인 안전한 브리지 (contextBridge)
  index.html   UI 마크업
  style.css    스타일 (포스트잇 느낌, 토글 블록)
  renderer.js  에디터 로직 (굵게, 토글 블록, 자동 저장)
test/
  renderer.test.js  Playwright 기반 에디터 테스트
```
