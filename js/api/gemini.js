export const geminiApi = {
    apiKey: null,
    apiUrl: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent",

    init(key) {
        this.apiKey = key;
    },

    async fetchGemini(prompt, retries = 3) {
        if (!this.apiKey) {
            throw new Error('Gemini API 키가 설정되지 않았습니다. 권한 화면에서 키를 입력해주세요.');
        }

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.1,
                topK: 1,
                topP: 0.1
            }
        };

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const errBody = await response.text();
                    throw new Error(`Gemini API 오류 (${response.status}): ${errBody}`);
                }

                const data = await response.json();

                if (data.candidates && data.candidates.length > 0) {
                    let text = data.candidates[0].content.parts[0].text;
                    // Markdown json block cleanup
                    text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
                    return text;
                } else {
                    throw new Error("Gemini가 유효한 응답을 생성하지 못했습니다.");
                }
            } catch (err) {
                console.warn(`Gemini API 호출 실패 (시도 ${attempt}/${retries}):`, err);
                if (attempt === retries) {
                    throw err; // 모든 재시도 실패 시 에러 던짐
                }
                // 짧게 대기 후 재시도 (Exponential Backoff 추가 가능)
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    },

    async askGeminiRAG(userText, ledgerCsvStr) {
        const RAG_PROMPT = `
당신은 친절하고 똑똑한 '시유 가계부'의 전속 금융 비서(이름: 시유봇)입니다.
아래에 предостав된 가계부 데이터(CSV 형식)를 분석하여 사용자의 질문에 정확하고 자연스럽게 대답하세요.

- 답변은 친근하고 공손한 해요체/합쇼체를 섞어 써주세요 (예: ~했어요, ~입니다).
- 가계부 내역에 없는 내용이면 지어내지 말고, "해당 내역을 찾을 수 없어요"라고 솔직하게 말하세요.
- 금액을 말할 때는 천원 단위 콤마(,)를 붙여서 보기 좋게 만들어주세요. (예: 1,500,000원)
- 강조할 부분은 마크다운(**굵게**)을 사용하고, 필요하다면 줄바꿈과 이모지(📊, 💰, 💡 등)를 적절히 섞어 시각적으로 보기 좋게 답해주세요.
- HTML 태그를 사용해도 됩니다. (예: <ul><li>...</li></ul>)

[가계부 데이터 (CSV)]
${ledgerCsvStr}

[사용자 질문]
"${userText}"
`;
        const res = await this.fetchGemini(RAG_PROMPT);
        // 간단한 마크다운을 HTML로 (단순 줄바꿈과 볼드체 정도만 파싱)
        let htmlDesc = res.replace(/\n/g, '<br/>');
        htmlDesc = htmlDesc.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        return htmlDesc;
    },

    async parseChatInput(userText, currentDateStr) {
        const CATEGORIES_LIST = "식비, 교통비, 이자, 관리비, 통신비, 공과금, 보험, 문화생활, 모임, 쇼핑, 그리시유, 경조사비, 저축, 병원, 수입, 기타";

        const prompt = `
당신은 텍스트를 파싱하여 정확하게 가계부 JSON 항목을 생성하는 훌륭한 파서입니다.
오늘 날짜는 ${currentDateStr} 입니다 (모든 상대적 날짜 '오늘', '어제' 등은 이 기준입니다).
아래 사용자 입력에서 [상호명, 금액(숫자), 카테고리, 날짜(YYYY-MM-DD)]를 추출하세요.

다음 카테고리 중 가장 적합한 하나를 고르세요: ${CATEGORIES_LIST}. 도저히 모르겠으면 '기타'를 선택하세요.
출력은 무조건 완벽한 1개의 JSON 객체 형식이어야 합니다. 마크다운이나 다른 설명은 절대 추가하지 마세요.

사용자 입력: "${userText}"

출력 예시:
{"place": "스타벅스", "amount": 4500, "category": "식비", "date": "2026-02-23"}
`;
        const res = await this.fetchGemini(prompt);
        return JSON.parse(res);
    },

    async askGeminiIntent(userText, todayStr, currentUser) {
        const prompt = `
당신은 가계부 작성 AI 비서입니다.
오늘 날짜는 ${todayStr} 입니다. 날짜가 '오늘', '어제' 등으로 오면 이를 계산하세요.
현재 사용자는 "${currentUser}" 입니다. 별도로 결제자를 지정하지 않으면 결제자는 "${currentUser}"(으)로 설정하세요.
사용자의 입력을 분석하여 다음 의도 중 하나로 분류하고, 반드시 JSON 형식으로만 응답해야 합니다 (마크다운 백틱 제외).

1. 지출/수입 내역 추가 (intent: "ADD")
사용자가 돈을 썼거나 돈이 들어왔다는 내용일 경우, 아래 구조로 데이터를 추출하세요 (금액은 양수 숫자). 월급, 용돈, 캐시백 등 들어온 돈이면 카테고리에 "수입"을 넣으세요. 나간 돈이면 카테고리는 식비, 교통비, 이자, 관리비, 통신비, 공과금, 보험, 문화생활, 모임, 쇼핑, 그리시유, 경조사비, 저축, 병원, 기타 중에서 가장 적합한 것을 고르세요.
{"intent": "ADD", "data": {"date": "YYYY-MM-DD", "amount": 10000, "place": "상호명", "payer": "결제자", "category": "분류"}}

2. 고정비 등록 (intent: "ADD_FIXED")
사용자가 "매달", "매월", "고정비", "정기", "자동이체" 등 반복적인 지출 항목을 등록하려는 경우. 매달 몇 일에 납부하는지(pay_day), 항목명(name), 금액(amount), 카테고리(category)를 추출하세요.
{"intent": "ADD_FIXED", "data": {"name": "항목명", "pay_day": 1, "amount": 150000, "category": "분류"}}

3. 지출 내역 삭제 (intent: "DELETE")
사용자가 기존 가계부 내역에서 특정 항목을 삭제하거나 취소해달라고 요청하는 경우.
{"intent": "DELETE", "data": null}

4. 지출 내역 수정 (intent: "EDIT")
사용자가 기존에 입력한 가계부 내역의 금액, 상호명, 카테고리 등을 수정하거나 변경해달라고 요청하는 경우. 예: "어제 스타벅스 5000원 금액 4500원으로 바꿔줘", "2월 25일 관리비 카테고리 공과금으로 수정해줘"
{"intent": "EDIT", "data": null}

5. 특정 내역 조회 및 질문 (intent: "INQUIRY")
사용자가 과거 내역에 대해 "구체적인 리스트나 항목"을 질문하는 경우. 이때 사용자 질문에서 "년도(YYYY)", "월(MM)", "카테고리(category)" 등 필터링할 조건이 있다면 뽑아내주세요.
없으면 null로 처리하세요. (예: "작년 식비 리스트 알려줘" -> 올해가 2026년이므로 date_prefix: "2025", category: "식비")
{"intent": "INQUIRY", "data": {"date_prefix": "YYYY-MM 혹은 YYYY", "category": "카테고리명"}}

6. 전체 통계/합산 요구 (intent: "INQUIRY_SUMMARY")
사용자가 "1년치 총 식비 얼마야?", "이번 달 총 지출은 얼마야?" 등 전체 합산 금액이나 거시적인 통계 결과를 묻는 경우.
{"intent": "INQUIRY_SUMMARY", "data": {"date_prefix": "YYYY-MM 혹은 YYYY", "category": "카테고리명"}}

7. 지출 분석 및 개선 조언 (intent: "ANALYSIS")
사용자가 "내 지출 분석해줘", "어떻게 하면 돈을 아낄까?", "이번 달 지출 패턴 어때?" 등 통계를 넘어선 분석 및 조언을 구하는 경우.
{"intent": "ANALYSIS", "data": {"date_prefix": "YYYY-MM 혹은 YYYY", "category": "카테고리명"}}

사용자 입력: "${userText}"
`;
        return await this.fetchGemini(prompt);
    }
};
