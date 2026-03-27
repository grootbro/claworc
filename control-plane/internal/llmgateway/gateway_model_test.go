package llmgateway

import "testing"

func TestResolveRequestedModelID(t *testing.T) {
	tests := []struct {
		name       string
		apiType    string
		bodyModel  string
		requestURL string
		want       string
	}{
		{
			name:       "body model wins for openai compat",
			apiType:    "openai-completions",
			bodyModel:  "gpt-5.2",
			requestURL: "/v1/chat/completions",
			want:       "gpt-5.2",
		},
		{
			name:       "google model extracted from generate content path",
			apiType:    "google-generative-ai",
			requestURL: "/models/gemini-3-flash-preview:generateContent",
			want:       "gemini-3-flash-preview",
		},
		{
			name:       "google model extracted from stream path",
			apiType:    "google-generative-ai",
			requestURL: "/models/gemini-2.5-flash:streamGenerateContent",
			want:       "gemini-2.5-flash",
		},
		{
			name:       "blank when unknown",
			apiType:    "google-generative-ai",
			requestURL: "/v1beta/files",
			want:       "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := resolveRequestedModelID(tc.apiType, tc.bodyModel, tc.requestURL)
			if got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}
