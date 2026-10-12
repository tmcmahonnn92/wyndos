export async function cookies() { return { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, has: () => false }; }
export async function headers() { return new Headers(); }
