# PeppaPrice voice and demo accounts

The panel header contains only the pig logo, PeppaPrice, and options. No model picker or Ready/Financial Advisor labels.

Voice inputs and text/suggestion inputs now share GPT Realtime with Marin. Text sends conversation.item.create with input_text, then response.create. It skips microphone capture. Audio uses the existing PCM16 capture path. The response always streams GPT Realtime audio. Claude remains an internal research tool, never a spoken voice. Missing configuration or errors stay visible rather than switching providers.

Official API reference: https://developers.openai.com/api/docs/guides/realtime-conversations

The backend owns speed 0.9; do not send a Swift binary floating-point 0.9 as session.audio.output.speed because JSONSerialization can exceed OpenAI's decimal precision limit. The client pins the output voice and checks the returned model/voice.

Live validation: RealtimeVoiceCheck.swift --text exercises the spending-button text request, history, screenshot fixture, research tool result, streamed audio, transcript, completion and cancellation. The existing audio fixture path exercises microphone-format PCM input without recording the user.

Seeder: scripts/seed_peppaprice_accounts.py (dry run by default; --execute writes only to Nessie sandbox). Ten synthetic customers: Jack, Nathan, Olivia, Ava, Emma, Liam, Noah, Sophia, Ethan and Mia. Each has checking and savings accounts; starting balances range from $450 to $9,315. Deposits and withdrawals exist on every account; checking accounts also have four purchase categories and three recurring bills. All values are retrieved from Nessie after selection. Existing accounts are preserved.
