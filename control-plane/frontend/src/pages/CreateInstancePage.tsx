import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { errorToast } from "@/utils/toast";
import InstanceForm from "@/components/InstanceForm";
import { useCreateInstance, useInstances } from "@/hooks/useInstances";
import { useAuth } from "@/contexts/AuthContext";


export default function CreateInstancePage() {
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const { data: instances = [] } = useInstances();
  const createMutation = useCreateInstance();
  const canCreateInstances = isAdmin || Boolean(user?.can_create_instances);
  const ownedCount = instances.filter((instance) => instance.owner_user_id === user?.id).length;

  return (
    <div>
      <button
        onClick={() => navigate("/")}
        className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 mb-4"
      >
        <ArrowLeft size={16} />
        Back to Dashboard
      </button>

      <h1 className="text-xl font-semibold text-gray-900 mb-6">
        Create Instance
      </h1>

      <div className="max-w-2xl">
        {!canCreateInstances ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
            This account cannot create instances yet. Ask an admin to enable self-service or assign an instance to you.
          </div>
        ) : null}
        {canCreateInstances && !isAdmin ? (
          <div className="mb-4 bg-white rounded-lg border border-gray-200 p-4 text-sm text-gray-700">
            Owned instances: <span className="font-medium">{ownedCount}</span>
            {user?.max_instances && user.max_instances > 0 ? (
              <> / <span className="font-medium">{user.max_instances}</span></>
            ) : (
              <> / <span className="font-medium">unlimited</span></>
            )}
          </div>
        ) : null}
        {canCreateInstances ? (
          <InstanceForm
            onSubmit={(payload) =>
              createMutation.mutate(payload, {
                onSuccess: () => {
                  navigate("/");
                },
                onError: (error: any) => {
                  if (error.response?.status === 409) {
                    errorToast("Failed to create instance", "An instance with the same name already exists");
                  } else {
                    errorToast("Failed to create instance", error);
                  }
                },
              })
            }
            onCancel={() => navigate("/")}
            loading={createMutation.isPending}
          />
        ) : null}
      </div>
    </div>
  );
}
