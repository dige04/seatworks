import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { ordersRpc } from "../../../shared/rpc.ts";
import type { OrdersView } from "../../../shared/views.ts";
import { useProjectRead } from "../../state/reads.ts";
import { FONT, SPACE } from "../kit/theme.ts";

type Props = { project: string; name: string; human: boolean; theme: PluginTheme };

/** `human` is whether the Human is in the loop: out of it, no landing waits for them and the Supervisor chooses. */
function Rules({ orders, name, human, theme }: { orders: OrdersView } & Omit<Props, "project">) {
  const { fault, askFirst, riskRules, ownRules, laneHome, concept } = orders;
  const mono = { fontFamily: "monospace", fontSize: FONT.small, color: theme.colors.foreground };
  return (
    <>
      <SettingsSection title="Ask me before landing changes to">
        <SettingsCard>
          {fault ? (
            <SettingsRow
              label="Your standing orders cannot be read"
              error={human ? `${fault} Until they are fixed, every landing waits for you.` : fault}
            />
          ) : null}
          {askFirst.map((path) => (
            <View key={path} style={{ padding: SPACE.lg }}>
              <Text style={mono}>{path}</Text>
            </View>
          ))}
          <SettingsRow
            label={askFirst.length > 0 ? "Everything else lands on its own" : "Nothing waits for you"}
            hint={
              human
                ? "A change there waits for you in the Supervisor's chat; the rest lands once its gate passes and a reviewer accepts it. The Supervisor may add a path; only you remove one, by telling it."
                : "You are out of the loop, so no landing waits for you now; these hold landings again once you are back in it."
            }
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={`Risky places · ${ownRules ? "this project's own" : "the kit's"}`}>
        <SettingsCard>
          {riskRules.map((rule) => (
            <SettingsRow
              key={rule.paths.join()}
              label={rule.paths.join("  ")}
              hint={`${rule.reviewQuestion}${rule.rehearse ? ` Rehearsed with ${rule.rehearse}.` : ""}`}
            />
          ))}
          <SettingsRow
            label="A rule never holds a landing"
            hint="Its question goes to every review of a change there."
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Where work happens">
        <SettingsCard>
          <SettingsRow
            label="Each line of work"
            hint={
              laneHome ??
              (human
                ? "Asked of you when your copy makes it a question."
                : "The Supervisor chooses when your copy makes it a question.")
            }
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={`What ${name} does`}>
        <SettingsCard>
          <SettingsRow
            label="CONTEXT.md"
            hint={
              concept
                ? `Written by the Supervisor from what you settled · ${concept.minutes} min ago`
                : "Nothing written yet: the Supervisor writes it as you settle what the project does."
            }
          />
          {concept ? (
            <View style={{ padding: SPACE.lg }}>
              <Text style={{ color: theme.colors.foreground, fontSize: FONT.small, lineHeight: 18 }}>
                {`${concept.text}${concept.more ? "\n…" : ""}`}
              </Text>
            </View>
          ) : null}
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

/** What the Human asked of a project, read once when the tab opens; they change it by telling the Supervisor. */
export function RulesTab({ project, name, human, theme }: Props) {
  const { value, error, reload } = useProjectRead(ordersRpc, project);
  if (!value)
    return (
      <SettingsCard>
        <SettingsAction
          label={error ? "The rules could not be read" : "Reading the rules"}
          error={error}
          actionLabel="Read again"
          onPress={reload}
        />
      </SettingsCard>
    );
  return <Rules orders={value} name={name} human={human} theme={theme} />;
}
