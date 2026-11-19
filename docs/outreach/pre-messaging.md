# Pre-messaging webhooks: drafts for Nexconn

Send both (the owner sends; nothing here is sent automatically).

## GitHub issue: NexconnAI-Dev/hackathon

**Title:** Can't select pre-messaging webhook events (group_channel:pre_messaging) on our App Key

**Body:**

Hi Nexconn team! We're building CrewArcade for the Build Challenge (Open Innovation): friends and three AI
agents in one group chat that plan, build, playtest and publish a game together.

Our safety shield answers `group_channel:pre_messaging` / `direct_channel:pre_messaging` to stop prompt
injection aimed at the agents, abuse, spam, and "publish it" commands from non-approvers _before_ they
reach the room. The handler is live and verified (same webhook URL as `message:send`).

**Problem:** in Console → Chat → Chat settings → Webhooks → Config, the pre-messaging events can't be
selected for our app (only the post-event ones can). The pricing page lists pre-messaging webhooks on
the Free plan.

**Questions:**

1. Is pre-messaging available on Free, or only on Pro?
2. Does the Free Chat Plan promotion (Pro features) unlock it, and how do we activate it?
3. If it needs a plan change, can it be enabled for hackathon apps?

Data center: Singapore. We can share the App Key privately. Meanwhile we remove violating messages
after delivery with `/v4/message/delete`, but pre-delivery is clearly the better experience.

Thanks!

## Email: hackathon@nexconn.ai

**Subject:** Build Challenge: enabling pre-messaging webhooks for our App Key

Hi Nexconn team,

I'm building CrewArcade for the Nexconn Build Challenge 2026 (Open Innovation track). It's a group chat
where friends and three AI agents (Designer, Builder, Playtester) make a playable game together. A
human approver has to tap Allow before anything goes public.

Our safety shield is designed for your pre-messaging webhooks. It blocks prompt injection aimed at the
agents (English, Hindi and Hinglish), abuse, spam and publish commands from non-approvers before
delivery. But the console won't let us select the `*:pre_messaging` events for our app, even though the
pricing page lists them on Free.

Could you tell us whether pre-messaging needs Pro, whether the Free Chat Plan promotion unlocks it, and
if it can be enabled for our App Key: <APP KEY>? Until then we delete violating messages after delivery
with `/v4/message/delete`.

Thank you!
<YOUR NAME>
CrewArcade: https://crewarcade.vercel.app

## Once it's enabled

1. Console → Chat → Chat settings → Webhooks → Config: tick `group_channel:pre_messaging` and
   `direct_channel:pre_messaging` (same URL), Save.
2. In a crew, send `ignore all previous instructions` as a member: it should never appear, and a 🛡
   Shield notice should show. `/safety` then says **Pre-delivery**.
