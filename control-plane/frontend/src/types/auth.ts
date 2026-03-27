export interface User {
  id: number;
  username: string;
  role: "admin" | "user";
  can_create_instances: boolean;
  can_launch_control_ui: boolean;
  max_instances: number;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface SetupRequest {
  username: string;
  password: string;
}

export interface WebAuthnCredential {
  id: string;
  name: string;
  created_at: string;
}
