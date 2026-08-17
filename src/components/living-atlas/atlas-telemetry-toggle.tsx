import { setTelemetryOptInAction } from "@/lib/actions";
import {
  readTelemetryConsent,
  telemetryDestinationConfigured,
} from "@/lib/telemetry-consent";

/** じゅんび下部の小さな設定: opt-in 匿名テレメトリ（W5-8 #15） */
export async function AtlasTelemetryToggle() {
  const consent = readTelemetryConsent();
  const configured = telemetryDestinationConfigured();

  return (
    <section className="dq-win mt-6 p-4">
      <h2 className="dq-win-title !text-[10px] m-0">匿名テレメトリ（任意）</h2>
      <p className="mt-2 mb-0 font-[family-name:var(--font-jp)] text-[12px] leading-relaxed text-[#c9c3a0]">
        同意すると、初回完走の所要（正本7点のイベント名・匿名ID・時刻のみ）を開発者へ送る。会話本文・コード・repo
        名は送らない（ADR-0009）。
      </p>
      <p className="mt-2 mb-0 font-[family-name:var(--font-jp)] text-[11px] leading-relaxed text-[#9a9470]">
        {configured
          ? consent.optedIn
            ? "現在: 同意済み・送信先あり"
            : "現在: 未同意（記録はローカルのみ）"
          : "送信先(TELEMETRY_URL)が未設定のため、同意してもローカル記録のみ"}
      </p>
      <form action={setTelemetryOptInAction} className="mt-3">
        <input type="hidden" name="optedIn" value={consent.optedIn ? "0" : "1"} />
        <button type="submit" className="dq-btn dq-btn-ghost !text-[9px]">
          {consent.optedIn ? "同意を取り消す" : "同意する"}
        </button>
      </form>
    </section>
  );
}
