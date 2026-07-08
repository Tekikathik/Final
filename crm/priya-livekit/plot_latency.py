"""
Render a latency chart from latency_log.csv (written by latency.py during calls).

    python plot_latency.py                 # uses latency_log.csv → latency_chart.png
    python plot_latency.py mylog.csv out.png

Shows, per conversation turn, the response latency broken into its three parts —
end-of-utterance delay, LLM time-to-first-token, TTS time-to-first-byte — stacked
to the total, with the average total marked.
"""
import sys
import csv
import matplotlib
matplotlib.use("Agg")          # headless: write a PNG, no display needed
import matplotlib.pyplot as plt

SRC = sys.argv[1] if len(sys.argv) > 1 else "latency_log.csv"
OUT = sys.argv[2] if len(sys.argv) > 2 else "latency_chart.png"

turns, eou, llm, tts, total = [], [], [], [], []
with open(SRC, newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        turns.append(int(row["turn"]))
        eou.append(float(row["eou_delay"]))
        llm.append(float(row["llm_ttft"]))
        tts.append(float(row["tts_ttfb"]))
        total.append(float(row["total"]))

if not turns:
    sys.exit("No rows in " + SRC + " — run a call first (python agent.py console).")

fig, ax = plt.subplots(figsize=(11, 5.5))
# Soft palette to match the dashboard.
ax.bar(turns, eou, label="End-of-utterance delay", color="#C8DBBE", edgecolor="white")
ax.bar(turns, llm, bottom=eou, label="LLM (time-to-first-token)", color="#CFE0FF", edgecolor="white")
bottom_tts = [e + l for e, l in zip(eou, llm)]
ax.bar(turns, tts, bottom=bottom_tts, label="TTS (time-to-first-byte)", color="#FBE6BE", edgecolor="white")
ax.plot(turns, total, "o-", color="#4F664A", linewidth=2, markersize=5, label="Total response latency")

avg = sum(total) / len(total)
ax.axhline(avg, ls="--", color="#9B2C2C", linewidth=1.3, label=f"Average {avg:.2f}s")

ax.set_title("Priya voice agent — per-turn response latency", fontsize=14, fontweight="bold", color="#2C2C2C")
ax.set_xlabel("Conversation turn")
ax.set_ylabel("Latency (seconds)")
ax.set_xticks(turns)
ax.grid(axis="y", alpha=0.3)
ax.legend(loc="upper right", fontsize=9, framealpha=0.95)
for spine in ("top", "right"):
    ax.spines[spine].set_visible(False)

p95 = sorted(total)[max(0, int(len(total) * 0.95) - 1)]
fig.text(0.012, 0.012, f"turns: {len(total)}   avg: {avg:.2f}s   min: {min(total):.2f}s   max: {max(total):.2f}s   p95: {p95:.2f}s",
         fontsize=9, color="#7A7A7A")

plt.tight_layout(rect=[0, 0.03, 1, 1])
plt.savefig(OUT, dpi=130)
print(f"wrote {OUT}  ({len(total)} turns, avg {avg:.2f}s)")
