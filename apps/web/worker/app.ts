// The Hono app every route module registers on, and the Worker's request variables.
import { Hono } from "hono";
import { type Bindings } from "./env";
import { type Reviewer } from "@sekaran-ind/yaxb-core/reviews";
import { type Moderator } from "@sekaran-ind/yaxb-core/moderators";
import { type DeviceCredentialView, type DeviceLockView, type Membership, type TokenClaims } from "@sekaran-ind/yaxb-core/identity";

export type AppEnv = {
  Bindings: Bindings;
  /** `account` and `space`: the signed-in account and its open space, checked on this request (identity.ts). */
  Variables: { reviewer: Reviewer; account?: TokenClaims; space?: Membership; lock?: DeviceLockView; machine?: Moderator; device?: DeviceCredentialView; spaceRefused?: { space_name: string; why: string; message: string } };
};

export const app = new Hono<AppEnv>();
