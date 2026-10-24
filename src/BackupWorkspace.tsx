import { useRef, useState } from "react";
import type { Portfolio } from "./domain/model";
import { reviewState } from "./domain/review";
import {
  envelope,
  parseBackup,
  RESTORE_POINT_KEY,
  MAX_BACKUP_BYTES,
  downloadText,
  type Envelope,
} from "./storage/backup";
import { Modal, Panel, money } from "./components";

export default function BackupWorkspace({
  p,
  savedAt,
  blocked,
  recovery,
  onExport,
  onRestore,
  onReset,
  onMessage,
}: {
  p: Portfolio;
  savedAt: string;
  blocked: boolean;
  recovery: string;
  onExport: () => void;
  onRestore: (p: Portfolio) => void;
  onReset: () => void;
  onMessage: (s: string) => void;
}) {
  const file = useRef<HTMLInputElement>(null),
    [pending, setPending] = useState<Envelope | null>(null);
  const [previous] = useState(() => {
    try {
      return localStorage.getItem(RESTORE_POINT_KEY);
    } catch {
      return null;
    }
  });
  let previousValid = false;
  if (previous) {
    try {
      parseBackup(previous);
      previousValid = true;
    } catch {}
  }
  const importFile = async (f: File) => {
    try {
      if (f.size > MAX_BACKUP_BYTES)
        throw new Error("备份文件不能超过 1 MiB。");
      setPending(parseBackup(await f.text()));
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "无法读取备份。");
    } finally {
      if (file.current) file.current.value = "";
    }
  };
  const restore = (next: Portfolio) => {
    try {
      localStorage.setItem(
        RESTORE_POINT_KEY,
        blocked ? recovery : JSON.stringify(envelope(p)),
      );
      onRestore({ ...next, demo: false });
      setPending(null);
    } catch {
      onMessage("无法保留恢复前的数据，请先导出备份，检查浏览器存储后再恢复。");
    }
  };
  return (
    <>
      <Panel
        title="备份与恢复"
        description="长期计划、配置理由、复查安排、快照和待完成方案一起保存。"
      >
        <div className="backup-grid">
          <div>
            <h3>保存一份备份</h3>
            <p>每次复查结束后导出，换设备时再导入。</p>
            <button className="btn primary" onClick={onExport}>
              导出 JSON 备份
            </button>
            <p className="field-note">
              最近导出：
              {reviewState(p).lastExportedAt
                ? new Date(reviewState(p).lastExportedAt!).toLocaleString()
                : "尚未导出"}
            </p>
          </div>
          <div>
            <h3>从备份恢复</h3>
            <p>先预览内容，再替换；恢复前的数据会保留一份。</p>
            <button
              className="btn"
              disabled={p.demo}
              onClick={() => file.current?.click()}
            >
              选择备份文件
            </button>
            <input
              ref={file}
              className="visually-hidden"
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
              }}
            />
            {p.demo && (
              <p className="field-note">退出演示后可以恢复自己的备份。</p>
            )}
          </div>
        </div>
      </Panel>
      {previous && (
        <Panel title="恢复前的数据仍保留">
          <p className="body-copy">
            恢复文件不会立即失去原配置，可以撤销上一次恢复。
          </p>
          <div className="button-row">
            {previousValid && (
              <button
                className="btn"
                disabled={p.demo}
                onClick={() => setPending(parseBackup(previous))}
              >
                撤销上次恢复
              </button>
            )}
            <button
              className="text-button"
              onClick={() =>
                downloadText(previous, "portfolio-before-restore.json")
              }
            >
              下载恢复前原始数据
            </button>
          </div>
        </Panel>
      )}
      {blocked && (
        <Panel title="原始数据仍保留">
          <p>当前保存已暂停，可以先下载原始内容，再导入有效备份恢复。</p>
          <button
            className="btn"
            onClick={() =>
              downloadText(
                recovery,
                "portfolio-pilot-recovery.txt",
                "text/plain",
              )
            }
          >
            下载原始内容
          </button>
        </Panel>
      )}
      <Panel title="本地存储说明">
        <p className="body-copy">
          数据只保存在当前浏览器，没有云同步。清理浏览器数据会删除记录；重要复查结束后请导出备份。
        </p>
        <p className="field-note">
          已有第 4
          版备份可直接导入；缺少的复查安排使用默认值，原持仓、策略与预算保留。未来无法识别的版本会停止导入，不会覆盖当前数据。
        </p>
        {savedAt && (
          <p className="field-note">
            最近自动保存：{new Date(savedAt).toLocaleString()}
          </p>
        )}
      </Panel>
      <Panel title="重新开始">
        <div className="maintenance-row">
          <p>清空当前持仓、策略与复查记录，建议先导出备份。</p>
          <button className="btn danger" disabled={p.demo} onClick={onReset}>
            清空当前配置
          </button>
        </div>
      </Panel>
      {pending && (
        <Modal title="预览待恢复的备份" onClose={() => setPending(null)}>
          <dl className="backup-preview">
            <div>
              <dt>备份日期</dt>
              <dd>{new Date(pending.savedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>组合市值</dt>
              <dd>
                {money(
                  pending.portfolio.assets.reduce((s, a) => s + a.value, 0),
                )}
              </dd>
            </div>
            <div>
              <dt>每月预算</dt>
              <dd>{money(pending.portfolio.monthlyPlan?.budget ?? 0)}</dd>
            </div>
            <div>
              <dt>每日预算</dt>
              <dd>
                {pending.portfolio.dailySettings
                  ? money(pending.portfolio.dailySettings.budget)
                  : "尚未设置"}
              </dd>
            </div>
            <div>
              <dt>临时调整计划</dt>
              <dd>
                {pending.portfolio.adjustment
                  ? `有，${pending.portfolio.adjustment.reviewDate} 复查`
                  : "无"}
              </dd>
            </div>
            <div>
              <dt>复查记录</dt>
              <dd>{pending.portfolio.review?.records.length ?? 0} 次</dd>
            </div>
            <div>
              <dt>下次复查</dt>
              <dd>{reviewState(pending.portfolio).nextDate}</dd>
            </div>
            <div>
              <dt>待完成复查</dt>
              <dd>
                {pending.portfolio.review?.active ? "有，可恢复后继续" : "无"}
              </dd>
            </div>
          </dl>
          <p className="field-note">
            确认后替换当前数据，并保留恢复前的原始内容。
          </p>
          <div className="editor-actions">
            <button className="btn" onClick={() => setPending(null)}>
              取消恢复
            </button>
            <button
              className="btn primary"
              onClick={() => restore(pending.portfolio)}
            >
              确认恢复并保留原数据
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
