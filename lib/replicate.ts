export type ReplicateInput = {
  image: string;
  style_image: string;
  prompt: string;
  negative_prompt?: string;
  num_inference_steps?: number;
  guidance_scale?: number;
  strength?: number;
};
