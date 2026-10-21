import { emptyPortfolio, type Portfolio } from "../domain/model";
import { STORAGE_KEY, parseBackup } from "./backup";
export interface Boot {
  p: Portfolio;
  blocked: boolean;
  raw: string;
  notice: string;
  savedAt: string;
}
export function loadPortfolio(storage: Pick<Storage, "getItem">): Boot {
  const empty = {
    p: emptyPortfolio(),
    blocked: false,
    raw: "",
    notice: "",
    savedAt: "",
  };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return empty;
    try {
      const e = parseBackup(raw);
      return { ...empty, p: e.portfolio, savedAt: e.savedAt };
    } catch {
      return {
        ...empty,
        blocked: true,
        raw,
        notice:
          "本地数据暂时无法读取，已保留原内容并暂停保存。可以导出原始数据后恢复备份。",
      };
    }
  } catch {
    return { ...empty, notice: "当前浏览器无法保存数据，请及时导出备份。" };
  }
}
