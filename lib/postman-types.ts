// Types derived directly from the Postman Collection Format v2.1.0 JSON schema.
// Every field is optional except where the schema marks it required, because
// real-world exports omit anything not set.

export interface PostmanCollection {
  info: PostmanInfo;
  item: PostmanItemOrGroup[];
  variable?: PostmanVariable[];
  auth?: PostmanAuth | null;
  event?: PostmanEvent[];
}

export interface PostmanInfo {
  name?: string;
  _postman_id?: string;
  description?: PostmanDescription;
  schema: string;
}

// A node is either a folder (item-group) or a request (item).
export type PostmanItemOrGroup = PostmanItemGroup | PostmanItem;

export interface PostmanItemGroup {
  name?: string;
  description?: PostmanDescription;
  item: PostmanItemOrGroup[]; // required for folders
  variable?: PostmanVariable[];
  auth?: PostmanAuth | null;
  event?: PostmanEvent[];
}

export interface PostmanItem {
  id?: string;
  name?: string;
  description?: PostmanDescription;
  request: PostmanRequest; // required for requests
  response?: PostmanResponse[];
  variable?: PostmanVariable[];
  event?: PostmanEvent[];
}

// Description: string | { content, type } | null
export type PostmanDescription =
  | string
  | { content?: string; type?: string; version?: unknown }
  | null;

// Request: object | string (string = URL, method assumed GET)
export type PostmanRequest = PostmanRequestObject | string;

export interface PostmanRequestObject {
  url?: PostmanUrl;
  method?: string;
  description?: PostmanDescription;
  header?: PostmanHeader[] | string;
  body?: PostmanBody | null;
  auth?: PostmanAuth | null;
}

// URL: object | string
export type PostmanUrl = PostmanUrlObject | string;

export interface PostmanUrlObject {
  raw?: string;
  protocol?: string;
  host?: string | string[];
  path?: string | Array<string | { type?: string; value?: string }>;
  port?: string;
  query?: PostmanQueryParam[];
  hash?: string;
  variable?: PostmanVariable[];
}

export interface PostmanQueryParam {
  key?: string | null;
  value?: string | null;
  disabled?: boolean;
  description?: PostmanDescription;
}

export interface PostmanHeader {
  key: string;
  value: string;
  disabled?: boolean;
  description?: PostmanDescription;
}

export interface PostmanBody {
  mode?: "raw" | "urlencoded" | "formdata" | "file" | "graphql";
  raw?: string;
  urlencoded?: PostmanUrlEncodedParam[];
  formdata?: PostmanFormParam[];
  file?: { src?: string | null; content?: string };
  graphql?: { query?: string; variables?: string };
  options?: { raw?: { language?: string } };
  disabled?: boolean;
}

export interface PostmanUrlEncodedParam {
  key: string;
  value?: string;
  disabled?: boolean;
  description?: PostmanDescription;
}

export interface PostmanFormParam {
  key: string;
  value?: string;
  src?: string | null | string[];
  type?: "text" | "file";
  contentType?: string;
  disabled?: boolean;
  description?: PostmanDescription;
}

export interface PostmanResponse {
  id?: string;
  name?: string;
  originalRequest?: PostmanRequest;
  header?: Array<PostmanHeader | string> | string | null;
  cookie?: unknown[];
  body?: string | null;
  status?: string;
  code?: number;
}

export interface PostmanVariable {
  id?: string;
  key?: string;
  value?: unknown;
  type?: string;
  name?: string;
  description?: PostmanDescription;
  disabled?: boolean;
}

export interface PostmanAuth {
  type: string;
  [key: string]: unknown;
}

export interface PostmanEvent {
  listen: string;
  script?: { exec?: string[] | string; type?: string };
  disabled?: boolean;
}