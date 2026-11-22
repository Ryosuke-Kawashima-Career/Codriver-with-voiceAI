import type { LanguageCode } from '../types';

export interface LanguageMeta {
  code: LanguageCode;
  label: string;
  nativeLabel: string;
  voiceLabel: string;
  sampleLine: string;
}

export const LANGUAGES: LanguageMeta[] = [
  {
    code: 'en-IN',
    label: 'English (India)',
    nativeLabel: 'English',
    voiceLabel: 'Rohan · Warm Indian English',
    sampleLine: 'Ready for a quick one along the highway?',
  },
  {
    code: 'hi-IN',
    label: 'Hindi',
    nativeLabel: 'हिन्दी',
    voiceLabel: 'Kabir · स्वाभाविक हिन्दी',
    sampleLine: 'सफ़र के साथ एक छोटे से सवाल के लिए तैयार हैं?',
  },
  {
    code: 'ta-IN',
    label: 'Tamil',
    nativeLabel: 'தமிழ்',
    voiceLabel: 'Iniya · இனிய தமிழ்',
    sampleLine: 'பயணத்தோடு ஒரு எளிய கேள்விக்குத் தயாரா?',
  },
];

export interface HostScripts {
  greeting: (hasRoute: boolean, routeName?: string) => string;
  offer: string;
  offerQuiet: string;
  nav800: (instruction: string) => string;
  nav100: (instruction: string) => string;
  backToQuestion: (prompt: string) => string;
  nextClueLead: string;
  landmarkFunFactOnly: (landmarkName: string, fact: string) => string;
  correctReply: (answer: string, fact: string) => string;
  missReply: (answer: string, fact: string) => string;
  silenceReply: (answer: string, fact: string) => string;
  skipReply: string;
  pausedReply: string;
  resumedReply: string;
  goodbye: (correct: number, asked: number) => string;
  ui: {
    directions: string;
    quiz: string;
    directionsFirst: string;
    correctAnswers: string;
    listeningHint: string;
    heardPrefix: string;
    pause: string;
    resume: string;
    skip: string;
    stop: string;
    states: {
      IDLE: string;
      OFFER: string;
      ASK: string;
      LISTEN: string;
      JUDGE: string;
      FEEDBACK: string;
      PAUSED: string;
    };
  };
}

export const HOST_SCRIPTS: Record<LanguageCode, HostScripts> = {
  'en-IN': {
    greeting: (hasRoute, routeName) =>
      hasRoute
        ? `Welcome aboard Safar. We are heading along ${routeName}. Keep your eyes on the road and just talk whenever you like.`
        : `Welcome aboard Safar. Just listen and speak your answers aloud whenever you are ready.`,
    offer: 'Ready for a quick one?',
    offerQuiet: 'No rush. I will stay quiet until the road opens up.',
    nav800: (instruction) => `In 800 metres, ${instruction}.`,
    nav100: (instruction) => `${instruction}.`,
    backToQuestion: (prompt) => `Back to the question: ${prompt}`,
    nextClueLead: 'Here is another clue.',
    landmarkFunFactOnly: (name, fact) => `We just passed ${name}. Quick note: ${fact}`,
    correctReply: (answer, fact) => `Spot on! ${answer}. ${fact}`,
    missReply: (answer, fact) => `Good try! The answer is ${answer}. ${fact}`,
    silenceReply: (answer, fact) => `No worries, it was ${answer}. ${fact}`,
    skipReply: 'Skipping that one.',
    pausedReply: 'Quiz paused. Say resume whenever you are ready.',
    resumedReply: 'Back on the road with you.',
    goodbye: (correct, asked) =>
      asked > 0
        ? `Thanks for driving with Safar. You answered ${correct} out of ${asked} questions. Have a safe journey ahead.`
        : `Thanks for driving with Safar. Have a safe journey ahead.`,
    ui: {
      directions: 'Directions',
      quiz: 'Quiz',
      directionsFirst: 'Directions first',
      correctAnswers: 'Correct',
      listeningHint: 'Listening… say your answer, or "skip", "repeat", "pause", "stop"',
      heardPrefix: 'Heard',
      pause: 'Pause',
      resume: 'Resume',
      skip: 'Skip',
      stop: 'Stop',
      states: {
        IDLE: 'Ready',
        OFFER: 'Asking',
        ASK: 'Asking',
        LISTEN: 'Listening',
        JUDGE: 'Checking',
        FEEDBACK: 'Speaking',
        PAUSED: 'Paused',
      },
    },
  },
  'hi-IN': {
    greeting: (hasRoute, routeName) =>
      hasRoute
        ? `सफ़र में आपका स्वागत है। हम ${routeName} के रास्ते पर हैं। आप सड़क पर ध्यान दें और बस बोलकर जवाब दें।`
        : `सफ़र में आपका स्वागत है। आराम से सुनिए और बोलकर जवाब दीजिए।`,
    offer: 'एक छोटे से सवाल के लिए तैयार हैं?',
    offerQuiet: 'कोई जल्दी नहीं, मैं अभी शांत रहता हूँ।',
    nav800: (instruction) => `800 मीटर में, ${instruction}।`,
    nav100: (instruction) => `${instruction}।`,
    backToQuestion: (prompt) => `सवाल पर लौटते हैं: ${prompt}`,
    nextClueLead: 'एक और संकेत सुनिए।',
    landmarkFunFactOnly: (name, fact) => `हम अभी ${name} के पास से गुज़रे। एक रोचक बात: ${fact}`,
    correctReply: (answer, fact) => `बिल्कुल सही! ${answer}। ${fact}`,
    missReply: (answer, fact) => `अच्छी कोशिश! सही जवाब है ${answer}। ${fact}`,
    silenceReply: (answer, fact) => `कोई बात नहीं, इसका जवाब है ${answer}। ${fact}`,
    skipReply: 'इसे छोड़ते हैं।',
    pausedReply: 'क्विज़ रोक दिया है। जब चाहें फिर से शुरू करें।',
    resumedReply: 'फिर से सफ़र पर लौटते हैं।',
    goodbye: (correct, asked) =>
      asked > 0
        ? `सफ़र के साथ यात्रा करने के लिए धन्यवाद। आपने ${asked} में से ${correct} सही जवाब दिए। आपकी यात्रा मंगलमय हो।`
        : `सफ़र के साथ यात्रा करने के लिए धन्यवाद। आपकी यात्रा मंगलमय हो।`,
    ui: {
      directions: 'दिशा-निर्देश',
      quiz: 'क्विज़',
      directionsFirst: 'दिशा पहले',
      correctAnswers: 'सही जवाब',
      listeningHint: 'सुन रहा हूँ… बोलें, या कहें "skip", "repeat", "pause", "stop"',
      heardPrefix: 'सुना गया',
      pause: 'रोकें',
      resume: 'जारी रखें',
      skip: 'छोड़ें',
      stop: 'बंद करें',
      states: {
        IDLE: 'तैयार',
        OFFER: 'पूछ रहा है',
        ASK: 'पूछ रहा है',
        LISTEN: 'सुन रहा है',
        JUDGE: 'जाँच रहा है',
        FEEDBACK: 'बोल रहा है',
        PAUSED: 'रुका हुआ',
      },
    },
  },
  'ta-IN': {
    greeting: (hasRoute, routeName) =>
      hasRoute
        ? `சஃபர் பயணத்திற்கு வரவேற்கிறோம். நாம் ${routeName} வழியில் செல்கிறோம். சாலையில் கவனம் செலுத்தி பேசினால் போதும்.`
        : `சஃபர் பயணத்திற்கு வரவேற்கிறோம். கேள்விகளைக் கேட்டு உரக்கப் பதில் சொல்லுங்கள்.`,
    offer: 'ஒரு எளிய கேள்விக்குத் தயாரா?',
    offerQuiet: 'பரவாயில்லை, சற்று அமைதியாக இருக்கிறேன்.',
    nav800: (instruction) => `800 மீட்டரில், ${instruction}.`,
    nav100: (instruction) => `${instruction}.`,
    backToQuestion: (prompt) => `மீண்டும் கேள்விக்கு வருவோம்: ${prompt}`,
    nextClueLead: 'இதோ இன்னொரு குறிப்பு.',
    landmarkFunFactOnly: (name, fact) => `நாம் ${name} அருகே கடந்தோம். ஒரு சுவாரசியத் தகவல்: ${fact}`,
    correctReply: (answer, fact) => `சரியான பதில்! ${answer}. ${fact}`,
    missReply: (answer, fact) => `நல்ல முயற்சி! சரியான பதில் ${answer}. ${fact}`,
    silenceReply: (answer, fact) => `பரவாயில்லை, இதன் பதில் ${answer}. ${fact}`,
    skipReply: 'இந்தக் கேள்வியைத் தாண்டுவோம்.',
    pausedReply: 'வினாடி வினா இடைநிறுத்தப்பட்டது. தயாரானதும் தொடரலாம்.',
    resumedReply: 'மீண்டும் பயணத்தைத் தொடர்வோம்.',
    goodbye: (correct, asked) =>
      asked > 0
        ? `சஃபருடன் பயணித்தமைக்கு நன்றி. ${asked} கேள்விகளில் ${correct} சரியான பதில்கள் அளித்தீர்கள். இனிய பயணம் தொடரட்டும்.`
        : `சஃபருடன் பயணித்தமைக்கு நன்றி. உங்கள் பயணம் இனிதாக அமையட்டும்.`,
    ui: {
      directions: 'வழிகாட்டி',
      quiz: 'வினாடி வினா',
      directionsFirst: 'வழிகாட்டி முதன்மை',
      correctAnswers: 'சரியானவை',
      listeningHint: 'கேட்கிறது… பதில் சொல்லுங்கள் அல்லது "skip", "repeat", "pause", "stop"',
      heardPrefix: 'கேட்டது',
      pause: 'நிறுத்து',
      resume: 'தொடர்',
      skip: 'தாவு',
      stop: 'முடி',
      states: {
        IDLE: 'தயார்',
        OFFER: 'கேட்கிறது',
        ASK: 'கேட்கிறது',
        LISTEN: 'கவனிக்கிறது',
        JUDGE: 'சரிபார்க்கிறது',
        FEEDBACK: 'பேசுகிறது',
        PAUSED: 'இடைநிறுத்தம்',
      },
    },
  },
};
