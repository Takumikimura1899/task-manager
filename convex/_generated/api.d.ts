/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as gitLinks from "../gitLinks.js";
import type * as http from "../http.js";
import type * as issues from "../issues.js";
import type * as lib_approval from "../lib/approval.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_gitAutomation from "../lib/gitAutomation.js";
import type * as lib_gitRef from "../lib/gitRef.js";
import type * as lib_githubReconcile from "../lib/githubReconcile.js";
import type * as lib_issueStatus from "../lib/issueStatus.js";
import type * as lib_members from "../lib/members.js";
import type * as lib_projects from "../lib/projects.js";
import type * as lib_rank from "../lib/rank.js";
import type * as lib_revision from "../lib/revision.js";
import type * as lib_taskStatus from "../lib/taskStatus.js";
import type * as lib_validators from "../lib/validators.js";
import type * as members from "../members.js";
import type * as projects from "../projects.js";
import type * as reconcile from "../reconcile.js";
import type * as repositories from "../repositories.js";
import type * as seed from "../seed.js";
import type * as tasks from "../tasks.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  gitLinks: typeof gitLinks;
  http: typeof http;
  issues: typeof issues;
  "lib/approval": typeof lib_approval;
  "lib/crypto": typeof lib_crypto;
  "lib/gitAutomation": typeof lib_gitAutomation;
  "lib/gitRef": typeof lib_gitRef;
  "lib/githubReconcile": typeof lib_githubReconcile;
  "lib/issueStatus": typeof lib_issueStatus;
  "lib/members": typeof lib_members;
  "lib/projects": typeof lib_projects;
  "lib/rank": typeof lib_rank;
  "lib/revision": typeof lib_revision;
  "lib/taskStatus": typeof lib_taskStatus;
  "lib/validators": typeof lib_validators;
  members: typeof members;
  projects: typeof projects;
  reconcile: typeof reconcile;
  repositories: typeof repositories;
  seed: typeof seed;
  tasks: typeof tasks;
  webhooks: typeof webhooks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
