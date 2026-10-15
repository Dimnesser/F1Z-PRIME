"""One-off check on vps4: convert the uploaded tdata zip and confirm the session is authorized (masked output only)."""
import asyncio
import glob
import os
import sys
import tempfile

sys.path.insert(0, '/tmp/f1z-tdcheck')
from app.config import get_settings  # noqa: E402
import importlib.util as _u  # noqa: E402
_spec = _u.spec_from_file_location('tdata_import', '/tmp/f1z-tdcheck/tdata_import.py')
tdata_import = _u.module_from_spec(_spec)
_spec.loader.exec_module(tdata_import)


async def main():
    from telethon import TelegramClient
    from telethon.tl.functions.account import GetAuthorizationsRequest
    s = get_settings()
    for path in glob.glob(os.path.join(s.sessions_dir, '*tdata*.zip')):
        print('zip', os.path.basename(path)[-10:])
        try:
            user_id, dc, key = tdata_import.extract(__import__('pathlib').Path(path))
            print('extract ok dc', dc, 'key', len(key), 'uid_digits', len(str(user_id)))
        except Exception as e:
            print('extract FAIL', type(e).__name__, e)
            continue
        with tempfile.TemporaryDirectory() as d:
            target = os.path.join(d, 'x.session')
            open(target, 'wb').write(tdata_import.to_session_bytes(__import__('pathlib').Path(path)))
            client = TelegramClient(target[:-8], s.telegram_api_id, s.telegram_api_hash, request_retries=0,
                                    connection_retries=1, timeout=8, flood_sleep_threshold=0)
            try:
                await asyncio.wait_for(client.connect(), 20)
                ok = await client.is_user_authorized()
                print('authorized', ok)
                if ok:
                    me = await client.get_me()
                    print('phone', ('+' + me.phone[:3] + '****' + me.phone[-2:]) if me.phone else None, 'uid_match', me.id == user_id)
                    auths = await client(GetAuthorizationsRequest())
                    print('devices', len(auths.authorizations))
            except Exception as e:
                print('connect FAIL', type(e).__name__, e)
            finally:
                await client.disconnect()


asyncio.run(main())
