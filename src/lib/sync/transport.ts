import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommandEnvelope, CommandResult, PullResult } from "./protocol";
import type { SyncTransport } from "./engine";

/** Tables whose changes wake the device. The push itself is only a hint. */
const WAKE_TABLES = [
  "shifts",
  "shift_roles",
  "opportunities",
  "registrations",
  "waitlist_entries",
  "attendance_events",
  "hour_entries",
  "volunteers",
  "notifications",
] as const;

export function createSupabaseTransport(client: SupabaseClient): SyncTransport {
  return {
    async push(envelope: CommandEnvelope): Promise<CommandResult> {
      const { data, error } = await client.rpc("apply_command", {
        p_operation_id: envelope.operationId,
        p_organization_id: envelope.organizationId,
        p_replica_id: envelope.replicaId,
        p_command: envelope.command,
        p_base_revision: envelope.baseWorkspaceRevision,
        p_entity_versions: envelope.entityVersions,
        p_payload: envelope.payload,
        p_client_created_at: envelope.clientCreatedAt,
      });
      if (error) throw new Error(error.message);
      return data as CommandResult;
    },

    async pull(organizationId: string, cursor: number, limit: number): Promise<PullResult> {
      const { data, error } = await client.rpc("pull_changes", {
        p_organization_id: organizationId,
        p_after: cursor,
        p_limit: limit,
      });
      if (error) throw new Error(error.message);
      const result = data as PullResult | null;
      if (!result) throw new Error("The server returned no change batch.");
      return result;
    },

    subscribe(organizationId: string, wake: () => void): () => void {
      // Realtime is a doorbell, never the source of truth: a missed message
      // costs one poll interval, not a lost change.
      let channel = client.channel(`volunteer-sync:${organizationId}`);
      for (const table of WAKE_TABLES) {
        channel = channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table,
            filter: `organization_id=eq.${organizationId}`,
          },
          () => wake(),
        );
      }
      channel.subscribe();
      return () => {
        void client.removeChannel(channel);
      };
    },
  };
}
