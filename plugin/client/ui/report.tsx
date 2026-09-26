import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text } from "react-native";
import { Empty } from "./bits.tsx";
import { reportRpc, reportSeenRpc } from "../../shared/rpc.ts";
import { message } from "../format/error.ts";
import { ago } from "../format/time.ts";
import type { ReportItem, ReportView } from "../../shared/views.ts";
import { useProjectRead } from "../state/reads.ts";

function Part({ title, hint, items, none }: { title: string; hint: string; items: ReportItem[]; none?: string }) {
  if (items.length === 0 && !none) return null;
  return (
    <SettingsCard>
      <SettingsRow label={title} hint={items.length === 0 ? none : hint} />
      {items.map((item) => (
        <SettingsRow key={item.title} label={item.title} hint={`${item.detail} · ${ago(item.minutes)}`} />
      ))}
    </SettingsCard>
  );
}

/** Where the window starts: the whole record until the Human first marks it read. */
function sinceText(window: ReportView["window"]): string {
  return window.from === null
    ? "The whole record: you have not marked it read yet."
    : `What happened since you marked it read, ${ago(Math.round((window.until - window.from) / 60_000))}.`;
}

/** `human` is whether the Human is in the loop: out of it, the Supervisor pushes what landed. */
function ProjectReport({ project, human, theme }: { project: string; human: boolean; theme: PluginTheme }) {
  const { value, error, reload } = useProjectRead(reportRpc, project);
  const seen = useRpc(reportSeenRpc);
  const [marking, setMarking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Marked read at the end of the page they read, so what came after it waits for the next one.
  const markRead = (until: number) => {
    setMarking(true);
    setProblem(null);
    seen({ project, until })
      .then((answer) => ("error" in answer ? setProblem(answer.error) : reload()))
      .catch((failure: unknown) => setProblem(message(failure)))
      .finally(() => setMarking(false));
  };
  if (error)
    return (
      <SettingsCard>
        <Empty theme={theme} title="The report could not be read" body={error} />
      </SettingsCard>
    );
  if (!value)
    return (
      <SettingsCard>
        <Empty
          theme={theme}
          title="Reading the record"
          body="This project since you last marked it read, from its record."
        />
      </SettingsCard>
    );
  return (
    <>
      <Part
        title="Needs you"
        hint="What holds up the most first. Questions and landings you answer on Flow; a permission, in the seat's chat in Paseo."
        items={value.needs}
        none="Nothing waits for you."
      />
      <Part
        title="Decided for you"
        hint="Pushes, work taken over a red gate, and permissions answered for you; a reason is in the words of whoever decided."
        items={value.decided}
      />
      <Part
        title="Went ahead on its recommendation"
        hint="Questions you have not answered that could be undone; tell the Supervisor to turn one back."
        items={value.ahead}
      />
      <Part
        title="Landed"
        hint={
          human
            ? "On the base in your copy; push it when you are ready."
            : "On the base in your copy; the Supervisor pushes it."
        }
        items={value.landed}
      />
      <Part title="Beyond a lane" hint="What could not be undone, and what was done about it." items={value.beyond} />
      <Part
        title="Withdrawn by the Supervisor"
        hint="Questions it took off your queue, and why."
        items={value.withdrawn}
      />
      <Part
        title="Answered in chat"
        hint="What the Supervisor put on record as your answer, beside what you wrote."
        items={value.chat}
      />
      <SettingsCard>
        {value.numbers.map((row) => (
          <SettingsRow key={row.title} label={row.title} hint={row.detail}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{row.value}</Text>
          </SettingsRow>
        ))}
        <SettingsAction
          label="Read it again"
          hint="It is read once when you open this tab."
          actionLabel="Read"
          onPress={reload}
        />
      </SettingsCard>
      <SettingsCard>
        <SettingsRow label="Since" hint={sinceText(value.window)} />
        <SettingsAction
          label="Mark read"
          hint="The next report starts where this one ends; what waits for you stays until it is settled."
          error={problem}
          actionLabel={marking ? "Marking" : "Mark read"}
          disabled={marking}
          onPress={() => markRead(value.window.until)}
        />
      </SettingsCard>
    </>
  );
}

/** The project since the Human last marked it read, from its record alone: no agent writes a word of it. */
export function ReportSection({ project, human, theme }: { project?: string; human: boolean; theme: PluginTheme }) {
  return (
    <SettingsSection
      title="Report"
      info="Read from the record, not written by an agent: this project since you last marked it read."
    >
      {project ? (
        <ProjectReport project={project} human={human} theme={theme} />
      ) : (
        <SettingsCard>
          <Empty theme={theme} title="A report is a project's" body="Open a project to read what happened in it." />
        </SettingsCard>
      )}
    </SettingsSection>
  );
}
