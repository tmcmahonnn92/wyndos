// Simulation stand-in for "@/auth": the signed-in user is whoever the script says.
type Session = { user: { id: string; role: string; email?: string; name?: string } } | null;
const g = globalThis as unknown as { __simSession?: Session };
export async function auth(): Promise<Session> { return g.__simSession ?? null; }
export const handlers = {};
export async function signIn() { throw new Error("signIn not available in simulation"); }
export async function signOut() {}
