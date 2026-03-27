import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Trash2,
  ShieldCheck,
  Shield,
  Key,
  SlidersHorizontal,
  Rocket,
  MonitorSmartphone,
  Search,
  CheckSquare,
  Square,
  Users,
  Info,
} from "lucide-react";
import { successToast, errorToast } from "@/utils/toast";
import {
  fetchUsers,
  createUser,
  deleteUser,
  updateUserRole,
  updateUserLimits,
  getUserInstances,
  setUserInstances,
  resetUserPassword,
  type UserListItem,
} from "@/api/users";
import { useInstances } from "@/hooks/useInstances";

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsers,
  });

  const [showCreate, setShowCreate] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserListItem | null>(null);
  const [manageTarget, setManageTarget] = useState<UserListItem | null>(null);

  if (isLoading) {
    return <div className="text-gray-500">Loading users...</div>;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Users</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage who can create instances, see shared workspaces, and launch Control UI.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Create User
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">
                Username
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">
                Role
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">
                Access
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">
                Created
              </th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                onResetPassword={() => setResetTarget(user)}
                onManageAccess={() => setManageTarget(user)}
                queryClient={queryClient}
              />
            ))}
          </tbody>
        </table>
      </div>

      {showCreate ? (
        <CreateUserDialog
          onClose={() => setShowCreate(false)}
          queryClient={queryClient}
        />
      ) : null}

      {resetTarget ? (
        <ResetPasswordDialog
          user={resetTarget}
          onClose={() => setResetTarget(null)}
          queryClient={queryClient}
        />
      ) : null}

      {manageTarget ? (
        <ManageAccessDialog
          user={manageTarget}
          onClose={() => setManageTarget(null)}
          queryClient={queryClient}
        />
      ) : null}
    </div>
  );
}

function UserRow({
  user,
  onResetPassword,
  onManageAccess,
  queryClient,
}: {
  user: UserListItem;
  onResetPassword: () => void;
  onManageAccess: () => void;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const deleteMut = useMutation({
    mutationFn: () => deleteUser(user.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      successToast("User deleted");
    },
    onError: (error) => errorToast("Failed to delete user", error),
  });

  const toggleRole = useMutation({
    mutationFn: () =>
      updateUserRole(user.id, user.role === "admin" ? "user" : "admin"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      successToast("Role updated");
    },
    onError: (error) => errorToast("Failed to update role", error),
  });

  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="px-4 py-3 font-medium text-gray-900">{user.username}</td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            user.role === "admin"
              ? "bg-purple-50 text-purple-700"
              : "bg-gray-100 text-gray-600"
          }`}
        >
          {user.role === "admin" ? <ShieldCheck size={12} /> : <Shield size={12} />}
          {user.role}
        </span>
      </td>
      <td className="px-4 py-3">
        {user.role === "admin" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700">
            <ShieldCheck size={12} />
            Admin bypasses user limits
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                user.can_create_instances
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-gray-100 text-gray-500"
              }`}
            >
              <Rocket size={12} />
              {user.can_create_instances
                ? user.max_instances > 0
                  ? `Self-service · ${user.max_instances} max`
                  : "Self-service · unlimited"
                : "Self-service off"}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                user.can_launch_control_ui
                  ? "bg-sky-50 text-sky-700"
                  : "bg-gray-100 text-gray-500"
              }`}
            >
              <MonitorSmartphone size={12} />
              {user.can_launch_control_ui ? "Control UI on" : "Control UI off"}
            </span>
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-gray-500">
        {user.created_at ? new Date(user.created_at).toLocaleDateString() : "—"}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={onManageAccess}
            className="rounded p-1.5 text-gray-400 hover:text-gray-600"
            title="Manage access and limits"
          >
            <SlidersHorizontal size={16} />
          </button>
          <button
            onClick={() => toggleRole.mutate()}
            className="rounded p-1.5 text-gray-400 hover:text-gray-600"
            title={user.role === "admin" ? "Demote to user" : "Promote to admin"}
          >
            {user.role === "admin" ? <Shield size={16} /> : <ShieldCheck size={16} />}
          </button>
          <button
            onClick={onResetPassword}
            className="rounded p-1.5 text-gray-400 hover:text-gray-600"
            title="Reset password"
          >
            <Key size={16} />
          </button>
          <button
            onClick={() => {
              if (confirm(`Delete user "${user.username}"?`)) {
                deleteMut.mutate();
              }
            }}
            className="rounded p-1.5 text-gray-400 hover:text-red-600"
            title="Delete user"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function CreateUserDialog({
  onClose,
  queryClient,
}: {
  onClose: () => void;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [canCreateInstances, setCanCreateInstances] = useState(false);
  const [canLaunchControlUI, setCanLaunchControlUI] = useState(false);
  const [maxInstances, setMaxInstances] = useState("0");

  const mutation = useMutation({
    mutationFn: () =>
      createUser({
        username,
        password,
        role,
        can_create_instances: canCreateInstances,
        can_launch_control_ui: canLaunchControlUI,
        max_instances: Number(maxInstances) || 0,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      successToast("User created");
      onClose();
    },
    onError: (error) => errorToast("Failed to create user", error),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5">
          <h2 className="text-xl font-semibold text-gray-900">Create User</h2>
          <p className="mt-1 text-sm text-gray-500">
            Set up login details and decide what the new user can do without an admin.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Role
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              required
            />
          </div>

          <div className="grid gap-3">
            <AccessToggleCard
              title="Allow self-service instance creation"
              description="Lets the user create or clone their own instances directly from the main UI."
              icon={<Rocket size={16} />}
              enabled={canCreateInstances}
              onToggle={setCanCreateInstances}
              accentClass={
                canCreateInstances
                  ? "border-emerald-200 bg-emerald-50/70"
                  : "border-gray-200 bg-gray-50/60"
              }
            >
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Max owned instances
                </label>
                <input
                  type="number"
                  min="0"
                  value={maxInstances}
                  onChange={(e) => setMaxInstances(e.target.value)}
                  disabled={!canCreateInstances}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                />
                <p className="mt-1 text-xs text-gray-500">0 = unlimited</p>
              </div>
            </AccessToggleCard>

            <AccessToggleCard
              title="Show Control UI launch button"
              description="Adds the OpenClaw launch icon for instances this user can already access."
              icon={<MonitorSmartphone size={16} />}
              enabled={canLaunchControlUI}
              onToggle={setCanLaunchControlUI}
              accentClass={
                canLaunchControlUI
                  ? "border-sky-200 bg-sky-50/70"
                  : "border-gray-200 bg-gray-50/60"
              }
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ManageAccessDialog({
  user,
  onClose,
  queryClient,
}: {
  user: UserListItem;
  onClose: () => void;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const { data: instances = [] } = useInstances();
  const { data: assigned } = useQuery({
    queryKey: ["users", user.id, "instances"],
    queryFn: () => getUserInstances(user.id),
  });

  const [canCreateInstances, setCanCreateInstances] = useState(user.can_create_instances);
  const [canLaunchControlUI, setCanLaunchControlUI] = useState(user.can_launch_control_ui);
  const [maxInstances, setMaxInstances] = useState(String(user.max_instances));
  const [selectedIds, setSelectedIds] = useState<number[]>(assigned?.instance_ids ?? []);
  const [search, setSearch] = useState("");
  const [showSharedOnly, setShowSharedOnly] = useState(false);

  useEffect(() => {
    if (assigned?.instance_ids) {
      setSelectedIds(assigned.instance_ids);
    }
  }, [assigned]);

  useEffect(() => {
    setCanCreateInstances(user.can_create_instances);
    setCanLaunchControlUI(user.can_launch_control_ui);
    setMaxInstances(String(user.max_instances));
  }, [user]);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredInstances = [...instances]
    .filter((instance) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        instance.display_name.toLowerCase().includes(normalizedSearch) ||
        instance.name.toLowerCase().includes(normalizedSearch);
      if (!matchesSearch) {
        return false;
      }
      return !showSharedOnly || selectedIds.includes(instance.id);
    })
    .sort((a, b) => {
      const aSelected = selectedIds.includes(a.id);
      const bSelected = selectedIds.includes(b.id);
      if (aSelected !== bSelected) {
        return aSelected ? -1 : 1;
      }
      return a.display_name.localeCompare(b.display_name);
    });

  const filteredIds = filteredInstances.map((instance) => instance.id);
  const sharedCount = selectedIds.length;
  const visibleSharedCount = filteredInstances.filter((instance) => selectedIds.includes(instance.id)).length;
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((instanceId) => selectedIds.includes(instanceId));

  const updateSelectedIds = (instanceId: number, checked: boolean) => {
    setSelectedIds((prev) => {
      if (checked) {
        return prev.includes(instanceId) ? prev : [...prev, instanceId];
      }
      return prev.filter((id) => id !== instanceId);
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      await updateUserLimits(user.id, {
        can_create_instances: canCreateInstances,
        can_launch_control_ui: canLaunchControlUI,
        max_instances: Number(maxInstances) || 0,
      });
      await setUserInstances(user.id, selectedIds);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["users", user.id, "instances"] });
      successToast("User access updated");
      onClose();
    },
    onError: (error) => errorToast("Failed to update user access", error),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-5xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex flex-col gap-3 border-b border-gray-100 pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold text-gray-900">
                Manage Access: {user.username}
              </h2>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                  user.role === "admin"
                    ? "bg-purple-50 text-purple-700"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {user.role === "admin" ? <ShieldCheck size={12} /> : <Shield size={12} />}
                {user.role}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Fine-tune what this user can create on their own, which instances they can see, and whether they can launch Control UI.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-600">
              <Users size={12} />
              {sharedCount} shared
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-600">
              <Search size={12} />
              {filteredInstances.length} in view
            </span>
          </div>
        </div>

        <div className="mt-5 space-y-5">
          {user.role === "admin" ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Admins already bypass visibility and launch checks. These settings mainly matter if you later demote this account to a regular user.
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <AccessToggleCard
              title="Self-service instance creation"
              description="Allows this user to create and clone their own instances from the main UI."
              icon={<Rocket size={16} />}
              enabled={canCreateInstances}
              onToggle={setCanCreateInstances}
              accentClass={
                canCreateInstances
                  ? "border-emerald-200 bg-emerald-50/70"
                  : "border-gray-200 bg-gray-50/60"
              }
            >
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Max owned instances
                </label>
                <input
                  type="number"
                  min="0"
                  value={maxInstances}
                  onChange={(e) => setMaxInstances(e.target.value)}
                  disabled={!canCreateInstances}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                />
                <p className="mt-1 text-xs text-gray-500">
                  0 = unlimited. Existing instances stay assigned even if this is lowered later.
                </p>
              </div>
            </AccessToggleCard>

            <AccessToggleCard
              title="Control UI launcher"
              description="Shows the red OpenClaw icon in the instance list and allows opening the embedded Control UI for instances this user can already access."
              icon={<MonitorSmartphone size={16} />}
              enabled={canLaunchControlUI}
              onToggle={setCanLaunchControlUI}
              accentClass={
                canLaunchControlUI
                  ? "border-sky-200 bg-sky-50/70"
                  : "border-gray-200 bg-gray-50/60"
              }
            >
              <div className="rounded-lg border border-sky-100 bg-white/80 px-3 py-2 text-xs text-gray-600">
                This only controls the launcher. The user still needs access to a shared or owned instance below.
              </div>
            </AccessToggleCard>
          </div>

          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="flex flex-col gap-4 border-b border-gray-100 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-gray-500" />
                  <h3 className="text-base font-semibold text-gray-900">Shared instances</h3>
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  Shared instances appear in the user&apos;s workspace and instance detail views without making the user a full admin.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedIds((prev) => [...new Set([...prev, ...filteredIds])]);
                  }}
                  disabled={filteredIds.length === 0 || allFilteredSelected}
                  className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <CheckSquare size={14} />
                  Select visible
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedIds((prev) => prev.filter((id) => !filteredIds.includes(id)));
                  }}
                  disabled={filteredIds.length === 0 || visibleSharedCount === 0}
                  className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Square size={14} />
                  Clear visible
                </button>
              </div>
            </div>

            <div className="border-b border-gray-100 px-5 py-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                <label className="relative block">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search instances by name"
                    className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setShowSharedOnly((prev) => !prev)}
                  className={`inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${
                    showSharedOnly
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : "border-gray-200 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {showSharedOnly ? <CheckSquare size={14} /> : <Square size={14} />}
                  Shared only
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-600">
                  {sharedCount} total shared
                </span>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-600">
                  {visibleSharedCount} selected in current view
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 font-medium text-sky-700">
                  <Info size={12} />
                  Control UI still depends on the launcher toggle above
                </span>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
              {filteredInstances.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-gray-500">
                  No instances match this filter.
                </div>
              ) : (
                filteredInstances.map((instance) => {
                  const checked = selectedIds.includes(instance.id);
                  return (
                    <label
                      key={instance.id}
                      className={`flex items-center justify-between gap-4 px-5 py-3 text-sm transition ${
                        checked ? "bg-blue-50/50" : "hover:bg-gray-50"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900">
                          {instance.display_name}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                          <span>{instance.name}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 font-medium ${
                              checked
                                ? "bg-blue-100 text-blue-700"
                                : "bg-gray-100 text-gray-500"
                            }`}
                          >
                            {checked ? "Shared" : "Hidden"}
                          </span>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => updateSelectedIds(instance.id, e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AccessToggleCard({
  title,
  description,
  icon,
  enabled,
  onToggle,
  accentClass,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  accentClass: string;
  children?: ReactNode;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${accentClass}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-gray-700 shadow-sm">
              {icon}
            </span>
            {title}
          </div>
          <p className="mt-2 text-sm text-gray-600">{description}</p>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

function ResetPasswordDialog({
  user,
  onClose,
  queryClient,
}: {
  user: UserListItem;
  onClose: () => void;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const mutation = useMutation({
    mutationFn: () => resetUserPassword(user.id, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      successToast("Password reset");
      onClose();
    },
    onError: (error) => errorToast("Failed to reset password", error),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      errorToast("Passwords do not match");
      return;
    }
    mutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">
          Reset Password: {user.username}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              New Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Confirm Password
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              required
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Reset
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
