import { ScrollView, StyleSheet, Text, View } from "react-native";

import { colors } from "../src/theme";

/** In-app mirror of docs/PROTOCOL.md's "One-time setup checklist" section —
 * kept short and phone-readable rather than a literal copy. Update both
 * places together if the setup steps change. */
export default function HelpScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>
        This app is one of three parts: this phone app, a small backend relay, and a
        "devagent" process on your PC that actually drives the CLI coding agent. All three
        need to be running for a task to work.
      </Text>

      <Section title="1. Backend (once, anywhere reachable by PC + phone)">
        <Code>{"cd backend\npython -m venv venv\n<activate the venv>\npip install -r requirements.txt"}</Code>
        <Code>{"uvicorn main:app --host 0.0.0.0 --port 8000"}</Code>
        <Hint>
          Must be <Bold>--host 0.0.0.0</Bold>, not localhost — otherwise nothing outside
          this PC (like your phone) can reach it.
        </Hint>
      </Section>

      <Section title="2. Devagent (once per PC)">
        <Code>{"cd devagent\npython -m venv venv\n<activate the venv>\npip install -r requirements.txt"}</Code>
        <Code>{"cp projects.example.json projects.json"}</Code>
        <Hint>
          Edit <Bold>device_id</Bold> (any name for this PC) and <Bold>backend_url</Bold>{" "}
          (ws://&lt;backend host&gt;:8000/ws/agent) in that file.
        </Hint>
        <Code>{'python manage_projects.py add "my-repo" /path/to/repo'}</Code>
        <Hint>Registers a project — it must already be a git repository.</Hint>
        <Code>{"python main.py"}</Code>
        <Hint>Look for "registered with backend as device_id=..." — that means it's live.</Hint>
      </Section>

      <Section title="3. CLI agents on your PC">
        <Text style={styles.body}>
          Whichever agent chip you pick on the New Task screen needs its CLI installed and
          on PATH:
        </Text>
        <Hint>
          <Bold>claude</Bold> — Claude Code CLI. Works out of the box, including
          phone-side Approve/Deny for shell commands.
        </Hint>
        <Hint>
          <Bold>gemini</Bold> — Google's Antigravity CLI (agy), if installed. Needs a
          one-time fix below or it silently denies every command it runs.
        </Hint>
        <Hint>
          <Bold>codex</Bold> — not yet verified to need anything extra.
        </Hint>
      </Section>

      <Section title="Antigravity / agy one-time fix">
        <Text style={styles.body}>
          Without this, every Antigravity task fails with a "jetski: ... auto-denied"
          error — it has no way to prompt for permission headlessly. On your PC, add this
          to <Bold>~/.gemini/antigravity-cli/settings.json</Bold> (create the file if it
          doesn't exist):
        </Text>
        <Code>{'{\n  "permissions": {\n    "allow": ["command(*)", "write_file(*)"]\n  }\n}'}</Code>
        <Hint>
          Tradeoff: this allows every command/write for Antigravity globally on this PC
          from then on — not scoped to just this app, and (unlike claude) there's no
          phone-side Approve/Deny for it.
        </Hint>
      </Section>

      <Section title="4. This phone app">
        <Hint>
          Backend Host (Settings screen, or phone/.env before building) must be your PC's{" "}
          <Bold>LAN IP</Bold>, e.g. 192.168.1.23:8000 — never "localhost", since that means
          this phone, not your PC. Find it with <Bold>ipconfig</Bold> on the PC. It can
          change when your router reassigns it (DHCP) — if this app ever shows
          "disconnected", check ipconfig again and update it here.
        </Hint>
        <Hint>Phone and PC must be on the same Wi-Fi network.</Hint>
        <Hint>
          <Bold>Two different things, easy to mix up:</Bold> the Expo/Metro QR code only
          loads this app itself onto your phone. The Backend Host above is the separate
          thing that connects the app to your devagent. Scanning the QR code successfully
          doesn't mean this app can talk to your PC yet.
        </Hint>
        <Hint>
          Chat history is stored on this phone only (never sent to the backend or
          devagent, never synced anywhere) — clearing this app's storage loses it.
        </Hint>
      </Section>

      <Section title="FAQ — where people actually get stuck">
        <Faq q="Nothing connects — the app just says &ldquo;connecting&rdquo; forever.">
          Both <Bold>backend</Bold> (uvicorn) and <Bold>devagent</Bold> (main.py) have to be
          running as separate processes on your PC the whole time you're using this app —
          neither starts the other. Check devagent's console for
          "registered with backend", and try opening http://&lt;PC IP&gt;:8000 in a browser
          — it should return {"{\"status\":\"ok\",...}"}.
        </Faq>

        <Faq q="I scanned the QR code — why won't it connect to my devagent?">
          The QR code and the Backend Host setting are two different things. The QR code
          only loads this app's code onto your phone (via Metro). Backend Host is the
          separate setting that actually connects the app to your PC. Getting the QR code
          to work doesn't mean Backend Host is right yet — check Settings.
        </Faq>

        <Faq q="What do I even put in Backend Host?">
          Your PC's LAN IP + the backend's port, e.g. 192.168.1.23:8000 — never
          "localhost" (that would mean this phone, not your PC). Find the IP with{" "}
          <Bold>ipconfig</Bold> on the PC (the active adapter's IPv4 address).
        </Faq>

        <Faq q="It worked yesterday, today it says disconnected — why?">
          Your PC's LAN IP most likely changed. Routers hand out IPs via DHCP and can
          reassign a different one on reboot/reconnect unless you've set a fixed
          reservation for this PC in your router's settings. Recheck ipconfig and update
          Backend Host in Settings — no rebuild needed.
        </Faq>

        <Faq q="I ran a task from my phone but see nothing in devagent's terminal on my PC.">
          That's expected — devagent's own terminal only logs connection/error events, not
          the task's actual output. The task's live output streams to this phone only, not
          your PC's console.
        </Faq>

        <Faq q="My task just shows a checkpoint and &ldquo;0 files changed&rdquo; — did it fail?">
          Not necessarily. A checkpoint commit is taken before every task, unconditionally,
          as a safety net — even if the agent doesn't change anything (e.g. it asked a
          clarifying question instead of editing). Read the last message; if it's a
          question, reply in the box below to continue that same conversation instead of
          starting a new task.
        </Faq>

        <Faq q="I got a &ldquo;jetski: ... auto-denied&rdquo; error — what is that?">
          "jetski" is Google's Antigravity CLI's own internal name for itself — it's the{" "}
          <Bold>gemini</Bold> agent, not claude. It means a command needed permission it
          has no way to ask for headlessly. See the Antigravity fix above.
        </Faq>

        <Faq q="Files from the gemini/Antigravity agent ended up in the wrong folder.">
          Antigravity needs to be told its workspace explicitly — make sure devagent is on
          the latest code (git pull, then restart devagent) and try again.
        </Faq>

        <Faq q="The agent says it needs permission, but I never see an Approve/Deny prompt.">
          Only the <Bold>claude</Bold> agent currently routes shell-command approvals to
          this phone. gemini/codex don't have that yet — for gemini, see the Antigravity
          fix above (it trades the prompt for allowing everything). Also double check
          devagent is actually connected (Devices screen status dot).
        </Faq>

        <Faq q="The reply box / Revert button isn't showing on the task screen.">
          They only appear once a task fully finishes. While the agent is still running
          (or waiting on an approval), there's nothing to reply to or revert yet.
        </Faq>

        <Faq q="I pulled the latest code — why doesn't anything seem different?">
          Neither side hot-reloads the other's changes. Restart devagent
          (<Bold>python main.py</Bold>) for devagent/backend code changes, and reload the
          app in Expo Go (or restart <Bold>npx expo start</Bold>) for phone app changes.
        </Faq>
      </Section>

      <Text style={styles.footnote}>
        Full details: docs/PROTOCOL.md's "One-time setup checklist" in the repo.
      </Text>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Code({ children }: { children: string }) {
  return (
    <View style={styles.codeBlock}>
      <Text style={styles.codeText}>{children}</Text>
    </View>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <Text style={styles.hint}>{children}</Text>;
}

function Bold({ children }: { children: React.ReactNode }) {
  return <Text style={styles.bold}>{children}</Text>;
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <View style={styles.faqItem}>
      <Text style={styles.faqQuestion}>{q}</Text>
      <Text style={styles.faqAnswer}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  intro: { color: colors.text, fontSize: 14, lineHeight: 20, marginBottom: 24 },
  section: { marginBottom: 28 },
  sectionTitle: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 10,
  },
  body: { color: colors.text, fontSize: 13, lineHeight: 19, marginBottom: 6 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  bold: { color: colors.text, fontWeight: "700" },
  codeBlock: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginTop: 6,
  },
  codeText: { color: colors.text, fontFamily: "monospace", fontSize: 12, lineHeight: 18 },
  footnote: { color: colors.muted, fontSize: 11, marginTop: 8, fontStyle: "italic" },
  faqItem: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  faqQuestion: { color: colors.text, fontSize: 14, fontWeight: "700", marginBottom: 6 },
  faqAnswer: { color: colors.muted, fontSize: 13, lineHeight: 19 },
});
