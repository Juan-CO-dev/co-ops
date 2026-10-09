import { VAULT_AUTO_HIDE_SECONDS } from "@/lib/vault-shared";

/** Parent-owned expiry and request generation; never retains a secret. */
export function createVaultRevealLifetime(onClear: () => void) {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    generation += 1;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    onClear();
  };
  return {
    clear,
    begin() {
      clear();
      return generation;
    },
    accept(requestGeneration: number, publish: () => void) {
      if (requestGeneration !== generation) return false;
      // Consume this request so a duplicate completion cannot extend its lifetime.
      generation += 1;
      timer = setTimeout(clear, VAULT_AUTO_HIDE_SECONDS * 1000);
      publish();
      return true;
    },
  };
}
