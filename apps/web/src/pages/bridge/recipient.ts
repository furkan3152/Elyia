/** Recipients typed by hand (pure). */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const ELY_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ely$/iu;

/** A recipient Elyia can send to: a 0x address or an Elysium Name (`name.ely`, resolved on chain by the reader). */
export function recipientProblem(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (ADDRESS.test(text) || ELY_NAME.test(text)) return null;
  if (/\.ely$/iu.test(text)) return "Elysium Names are letters, digits and hyphens before .ely.";
  return "A 0x address (40 hex characters) or a name.ely.";
}

