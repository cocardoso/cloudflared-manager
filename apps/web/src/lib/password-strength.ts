export type PasswordStrength = 0 | 1 | 2 | 3 | 4;

const COMMON = /password|senha|qwerty|letmein|admin|welcome|iloveyou|123456/i;
const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

/** True when the password contains a run of 4+ characters taken in order (or reverse) from a common sequence. */
function hasSequence(pw: string) {
  const s = pw.toLowerCase();
  for (const seq of SEQUENCES) {
    for (const src of [seq, [...seq].reverse().join('')]) {
      for (let i = 0; i + 4 <= src.length; i++) if (s.includes(src.slice(i, i + 4))) return true;
    }
  }
  return false;
}

/**
 * Rough, dependency-free strength estimate: 0 = empty, then weak (1), fair (2), good (3), strong (4).
 * Length and character variety add points; repeats, sequences and common words take them away.
 */
export function passwordStrength(pw: string): PasswordStrength {
  if (!pw) return 0;
  const length = (pw.length >= 8 ? 1 : 0) + (pw.length >= 12 ? 1 : 0) + (pw.length >= 16 ? 1 : 0);
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((r) => r.test(pw)).length;
  const variety = (classes >= 2 ? 1 : 0) + (classes >= 3 ? 1 : 0);
  const penalty = (/(.)\1{2,}/.test(pw) ? 1 : 0) + (hasSequence(pw) ? 1 : 0) + (COMMON.test(pw) ? 1 : 0);
  const score = length + variety - penalty;
  return score <= 1 ? 1 : score === 2 ? 2 : score === 3 ? 3 : 4;
}
