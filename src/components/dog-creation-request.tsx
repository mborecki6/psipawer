"use client";

import { useState } from "react";

export function DogCreationRequest({ requestId }: { requestId: string }) {
  // A server revalidation must not turn a retry into another creation request.
  const [initialRequestId] = useState(requestId);
  return (
    <input type="hidden" name="creation_request_id" value={initialRequestId} />
  );
}
