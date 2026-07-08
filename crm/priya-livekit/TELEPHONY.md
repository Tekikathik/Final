# Connect your Twilio number → LiveKit → Priya

Call flow (this replaces your old Twilio Media Streams WebSocket):
```
Caller dials +12294083819
   → Twilio answers, routes via Elastic SIP Trunk
   → SIP → LiveKit SIP endpoint (your-project.sip.livekit.cloud)
   → LiveKit matches the inbound trunk + dispatch rule
   → creates room "call-xxxx" and dispatches agent "priya"
   → Priya (agent.py) joins and talks
```

You configure **two sides**: Twilio (send the call out via SIP) and LiveKit (accept it + dispatch the agent).

---

## Prerequisites
- LiveKit Cloud project (with `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` in `.env`).
- The **LiveKit CLI** (`lk`): https://docs.livekit.io/home/cli/cli-setup/
  ```bash
  lk cloud auth          # logs the CLI into your project
  ```
- Your Twilio number: **+12294083819** (already in your account).

---

## Part A — LiveKit side (accept the call + dispatch Priya)

**1. Find your SIP host.** It's on the LiveKit Cloud **Project Settings** page, format:
`<project-id>.sip.livekit.cloud` (e.g. `vjnxecm0tjk.sip.livekit.cloud`). You'll give this to Twilio in Part B.

**2. Create the inbound trunk** (accepts calls for your number):
```bash
lk sip inbound create sip/inbound-trunk.json
```

**3. Create the dispatch rule** (puts each call in its own room + dispatches agent "priya"):
```bash
lk sip dispatch create sip/dispatch-rule.json
```
> If a subcommand name differs on your CLI version, run `lk sip --help` (older builds use
> `lk sip inbound-trunk create` / `lk sip dispatch-rule create`).

**4. Run the agent** (registers as "priya", waits for dispatch):
```bash
python agent.py dev
```

---

## Part B — Twilio side (send the call to LiveKit over SIP)

In the **Twilio Console → Elastic SIP Trunking → Manage → Trunks**:

1. **Create a trunk** (e.g. "LiveKit-Priya").
2. **Origination** → add an Origination URI pointing at your LiveKit SIP host:
   ```
   sip:<project-id>.sip.livekit.cloud;transport=tcp
   ```
   (use the host from Part A step 1 — keep `;transport=tcp`).
3. **Numbers** → attach **+12294083819** to this trunk.

That's it for inbound. (Termination/credential-list auth is only needed for *outbound* calls.)

---

## Test
Call **+12294083819** from any phone. You should see in the `python agent.py dev` logs a SIP
participant join a `call-xxxx` room and Priya greet you. If not, check:
- `lk sip inbound list` / `lk sip dispatch list` show your trunk + rule.
- The agent is running (`python agent.py dev`) and registered as `priya`.
- Twilio's Origination URI host exactly matches your LiveKit SIP host.

---

## Outbound calls (optional, later)
To have Priya *call* a number (like your current `trigger-call`):
1. Add **Termination** to the Twilio trunk (a Termination SIP URI + a credential list with username/password).
2. Create a LiveKit **outbound trunk** with those Twilio credentials.
3. Dial with `lk sip participant create` (or the SIP API) into a room the agent joins.
See: https://docs.livekit.io/agents/start/telephony/  (outbound section).
