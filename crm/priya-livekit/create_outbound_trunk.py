"""
Create a LiveKit OUTBOUND SIP trunk from sip/outbound-trunk.json — WITHOUT the `lk` CLI.

Why this exists: the `lk` CLI isn't always on PATH on Windows. This does the same thing
using the `livekit` Python package (already in your venv) and reads LIVEKIT_URL / API_KEY /
API_SECRET straight from .env — same as make_call.py.

Steps:
  1. Put your NEW Twilio details in sip/outbound-trunk.json
     (address = Termination SIP URI, numbers = your Twilio number, auth_username/password
      = the Credential List you made in Twilio).
  2. python create_outbound_trunk.py
  3. Copy the printed ST_... id into .env as  OUTBOUND_TRUNK_ID=ST_...
"""
import json
import asyncio
from dotenv import load_dotenv
from livekit import api

load_dotenv()


async def main():
    with open("sip/outbound-trunk.json", "r", encoding="utf-8") as f:
        cfg = json.load(f)["trunk"]

    print(f"Creating outbound trunk -> {cfg['address']}  (caller ID {cfg['numbers']})")

    lk = api.LiveKitAPI()  # reads LIVEKIT_URL / API_KEY / API_SECRET from .env
    try:
        trunk = api.SIPOutboundTrunkInfo(
            name=cfg["name"],
            address=cfg["address"],          # Twilio Termination SIP URI (no sip: prefix)
            numbers=cfg["numbers"],          # caller ID — must be a number you own in Twilio
            auth_username=cfg.get("auth_username", ""),
            auth_password=cfg.get("auth_password", ""),
            # transport omitted → defaults to AUTO, which is correct for Twilio.
        )
        res = await lk.sip.create_sip_outbound_trunk(
            api.CreateSIPOutboundTrunkRequest(trunk=trunk)
        )
        print("\n[OK] Outbound trunk created.")
        print(f"   Trunk ID: {res.sip_trunk_id}")
        print(f"\n   -> Put this line in .env:\n     OUTBOUND_TRUNK_ID={res.sip_trunk_id}")
    finally:
        await lk.aclose()


if __name__ == "__main__":
    asyncio.run(main())
