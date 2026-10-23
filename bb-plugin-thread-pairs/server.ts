import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const rpcContract = defineRpcContract({
  trace: {
    input: z.object({ event: z.string().max(64), data: z.record(z.string(), z.unknown()).optional() }),
    output: z.null(),
  },
});

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");
  bb.rpc.register(rpcContract, {
    trace: ({ event, data }) => {
      bb.log.info(`${event} ${JSON.stringify(data ?? {})}`);
      return null;
    },
  });
}
