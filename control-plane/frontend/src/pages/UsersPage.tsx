import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, ShieldCheck, Shield, Key, SlidersHorizontal } from "lucide-react";
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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Users</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
        >
          Create User
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Username
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Role
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Self-service
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Created
              </th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">
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

      {showCreate && (
        <CreateUserDialog
          onClose={() => setShowCreate(false)}
          queryClient={queryClient}
        />
      )}

      {resetTarget && (
        <ResetPasswordDialog
          user={resetTarget}
          onClose={() => setResetTarget(null)}
          queryClient={queryClient}
        />
      )}

      {manageTarget && (
        <ManageAccessDialog
          user={manageTarget}
          onClose={() => setManageTarget(null)}
          queryClient={queryClient}
        />
      )}
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
          className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${
            user.role === "admin"
              ? "bg-purple-50 text-purple-700"
              : "bg-gray-100 text-gray-600"
          }`}
        >
          {user.role === "admin" ? (
            <ShieldCheck size={12} />
          ) : (
            <Shield size={12} />
          )}
          {user.role}
        </span>
      </td>
      <td className="px-4 py-3 text-gray-600">
        {user.can_create_instances ? (
          <span>
            enabled
            {user.max_instances > 0 ? ` · ${user.max_instances} max` : " · unlimited"}
          </span>
        ) : (
          <span className="text-gray-400">disabled</span>
        )}
      </td>
      <td className="px-4 py-3 text-gray-500">
        {user.created_at
          ? new Date(user.created_at).toLocaleDateString()
          : "—"}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={onManageAccess}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
            title="Manage access and limits"
          >
            <SlidersHorizontal size={16} />
          </button>
          <button
            onClick={() => toggleRole.mutate()}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
            title={
              user.role === "admin" ? "Demote to user" : "Promote to admin"
            }
          >
            {user.role === "admin" ? (
              <Shield size={16} />
            ) : (
              <ShieldCheck size={16} />
            )}
          </button>
          <button
            onClick={onResetPassword}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
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
            className="p-1.5 text-gray-400 hover:text-red-600 rounded"
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
  const [maxInstances, setMaxInstances] = useState("0");

  const mutation = useMutation({
    mutationFn: () => createUser({
      username,
      password,
      role,
      can_create_instances: canCreateInstances,
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-sm p-6">
        <h2 className="text-lg font-semibold mb-4">Create User</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={canCreateInstances}
              onChange={(e) => setCanCreateInstances(e.target.checked)}
            />
            Allow self-service instance creation
          </label>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Max owned instances
            </label>
            <input
              type="number"
              min="0"
              value={maxInstances}
              onChange={(e) => setMaxInstances(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">0 = unlimited</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
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
  const [maxInstances, setMaxInstances] = useState(String(user.max_instances));
  const [selectedIds, setSelectedIds] = useState<number[]>(assigned?.instance_ids ?? []);

  useEffect(() => {
    if (assigned?.instance_ids) {
      setSelectedIds(assigned.instance_ids);
    }
  }, [assigned]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await updateUserLimits(user.id, {
        can_create_instances: canCreateInstances,
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl p-6">
        <h2 className="text-lg font-semibold mb-4">Manage Access: {user.username}</h2>
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700 col-span-2">
              <input
                type="checkbox"
                checked={canCreateInstances}
                onChange={(e) => setCanCreateInstances(e.target.checked)}
              />
              Allow self-service instance creation
            </label>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max owned instances
              </label>
              <input
                type="number"
                min="0"
                value={maxInstances}
                onChange={(e) => setMaxInstances(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">0 = unlimited</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Visible / shared instances
            </label>
            <div className="max-h-72 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
              {instances.map((instance) => {
                const checked = selectedIds.includes(instance.id);
                return (
                  <label key={instance.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-gray-800">{instance.display_name}</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setSelectedIds((prev) => {
                          if (e.target.checked) {
                            return prev.includes(instance.id) ? prev : [...prev, instance.id];
                          }
                          return prev.filter((id) => id !== instance.id);
                        });
                      }}
                    />
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      </div>
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-sm p-6">
        <h2 className="text-lg font-semibold mb-4">
          Reset Password: {user.username}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              New Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm Password
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              required
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              Reset
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
