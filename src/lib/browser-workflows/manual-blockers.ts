// Recognises manual blockers — states a no-mouse operator cannot get past on its
// own (login, 2FA, CAPTCHA, permission walls). When one is detected the loop must
// ask the user to resolve it and then *resume the same task*, never claim success.

export const LOGIN_PATTERNS: RegExp[] = [
  /accounts\.google\.com/i,
  /\bsign ?in\b/i,
  /\blog ?in\b/i,
  /\bbejelentkez/i,
  /\bjelentkezz be\b/i,
  /email or phone/i,
  /choose an account/i,
  /fiók kiválasztása/i,
  /enter your password/i,
  /add meg a jelszavad/i,
];

export const TWOFA_PATTERNS: RegExp[] = [
  /2-?step verification/i,
  /two-?factor/i,
  /kétlépcsős/i,
  /verification code/i,
  /megerősítő kód/i,
];

export const CAPTCHA_PATTERNS: RegExp[] = [
  /captcha/i,
  /i'?m not a robot/i,
  /nem vagyok robot/i,
  /recaptcha/i,
  /hcaptcha/i,
];

export const PERMISSION_PATTERNS: RegExp[] = [
  /access denied/i,
  /permission required/i,
  /you (don'?t|do not) have (access|permission)/i,
  /nincs (jogosultság|hozzáférés)/i,
  /request access/i,
  /403 forbidden/i,
];

function anyMatch(patterns: RegExp[], text: string): string[] {
  return patterns.filter((p) => p.test(text)).map((p) => p.source);
}

export interface BlockerResult {
  blocked: boolean;
  kind?: 'login_required' | 'captcha' | 'permission_required';
  signals: string[];
}

export function detectManualBlocker(text: string): BlockerResult {
  const login = anyMatch(LOGIN_PATTERNS, text).concat(anyMatch(TWOFA_PATTERNS, text));
  if (login.length) return { blocked: true, kind: 'login_required', signals: login };
  const captcha = anyMatch(CAPTCHA_PATTERNS, text);
  if (captcha.length) return { blocked: true, kind: 'captcha', signals: captcha };
  const perm = anyMatch(PERMISSION_PATTERNS, text);
  if (perm.length) return { blocked: true, kind: 'permission_required', signals: perm };
  return { blocked: false, signals: [] };
}

/** A clear, state-preserving handoff message for a login/2FA/CAPTCHA wall. */
export function manualHandoffMessage(kind: BlockerResult['kind']): string {
  switch (kind) {
    case 'captcha':
      return 'Egy CAPTCHA / "nem vagyok robot" ellenőrzés jelent meg. Kérlek oldd meg a böngészőben, majd írd: kész. Utána folytatom.';
    case 'permission_required':
      return 'Az oldal hozzáférést kér vagy megtagadta. Kérlek rendezd a hozzáférést a böngészőben, majd írd: kész. Utána folytatom.';
    case 'login_required':
    default:
      return 'A bejelentkezési oldal látszik. Kérlek jelentkezz be a böngészőben, majd írd: kész. Utána folytatom a feladatot ugyanazzal a céllal.';
  }
}
