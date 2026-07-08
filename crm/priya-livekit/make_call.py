"""
Place an OUTBOUND call — Priya dials a phone number through Twilio and talks.
(Like the old Node trigger-call, but via LiveKit SIP.)

Prereqs:
  1. Twilio Termination set up (Termination SIP URI + a Credential List). See TELEPHONY.md.
  2. A LiveKit OUTBOUND trunk created from that — its ID goes in .env as OUTBOUND_TRUNK_ID.
  3. The agent worker running:  python agent.py dev

Usage:
  python make_call.py +918249776759       # call this number
  python make_call.py                      # calls CALL_TO from .env
"""
import os
import sys
import time
import asyncio
from dotenv import load_dotenv
from livekit import api

load_dotenv()


async def main():
    number = sys.argv[1] if len(sys.argv) > 1 else os.getenv("CALL_TO", "")
    if not number:
        sys.exit("Give a number: python make_call.py +918249776759  (or set CALL_TO in .env)")
    trunk = os.getenv("OUTBOUND_TRUNK_ID")           # set after creating the outbound trunk
    if not trunk:
        sys.exit(
            "OUTBOUND_TRUNK_ID is not set in .env yet.\n"
            "Outbound needs: (1) Twilio Termination (URI + Credential List), then\n"
            "(2) a LiveKit outbound trunk created from it. Send me the 3 Twilio values\n"
            "(termination URI, username, password) and I'll create the trunk + set this."
        )
    room = f"call-{number.lstrip('+')}-{int(time.time())}"

    lk = api.LiveKitAPI()  # reads LIVEKIT_URL / API_KEY / API_SECRET from .env
    try:
        # 1) Put Priya in the room first, so she's ready the instant they pick up.
        await lk.agent_dispatch.create_dispatch(
            api.CreateAgentDispatchRequest(agent_name="priya", room=room)
        )
        # 2) Dial the number into that room through the Twilio outbound trunk.
        await lk.sip.create_sip_participant(
            api.CreateSIPParticipantRequest(
                sip_trunk_id=trunk,
                sip_call_to=number,
                room_name=room,
                participant_identity="phone_user",
                participant_name="Prospect",
                wait_until_answered=True,
            )
        )
        print(f"📞 Connected — calling {number}, Priya is in room {room}")
    finally:
        await lk.aclose()


if __name__ == "__main__":
    asyncio.run(main())
