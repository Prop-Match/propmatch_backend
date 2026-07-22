import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { Observable } from "rxjs";

@Injectable()
export class FormOptimizerService {
    private readonly logger = new Logger(FormOptimizerService.name);

    private createFallbackDescription(description: unknown, context: Record<string, unknown>): string {
        const original = typeof description === "string" ? description.trim() : "";
        const location = [context.district, context.city, context.governorate]
            .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            .join("? ");
        const details = [
            typeof context.areaM2 === "number" ? `?????? ${context.areaM2} ??? ????` : "",
            typeof context.bedrooms === "number" ? `???? ${context.bedrooms} ??? ???` : "",
            typeof context.bathrooms === "number" ? `?${context.bathrooms} ??????` : "",
        ].filter(Boolean).join(" ");
        const features = [
            context.isFurnished === true ? "??????" : context.isFurnished === false ? "??? ??????" : "",
            context.hasElevator === true ? "?? ????" : "",
            context.hasParking === true ? "????? ??????" : "",
        ].filter(Boolean).join("? ");
        const rent = typeof context.rentAmount === "number" ? `???? ????? ???? ???? ${context.rentAmount} ????` : "";

        const opening = original
            ? /[.!?]$/.test(original) ? original : `${original}.`
            : "???? ???? ???????.";

        return [
            opening,
            location ? `??? ?????? ?? ${location}${details ? ` ${details}.` : "."}` : details ? `${details}.` : "",
            [features, rent].filter(Boolean).join("? ") ? `?????? ${[features, rent].filter(Boolean).join("? ")}.` : "",
        ].filter(Boolean).join(" ");
    }

    optimizeDescriptionStream(payload: any): Observable<any> {
        return new Observable((subscriber) => {
            (async () => {
                try {
                    const apiKey = process.env.SBG_API_KEY;
                    if (!apiKey) {
                        throw new InternalServerErrorException('SBG_API_KEY is not defined');
                    }
                    
                    const { description, ...context } = payload;
                    
                    const systemPrompt = "You are an expert real estate copywriter. Write a polished Arabic rental-listing description using only the supplied details. Keep it between 80 and 120 words, use two or three complete sentences, do not invent facts, and end with sentence-ending punctuation. Return only the final description, with no heading or commentary.";
                    const content = `Original Description: ${description || "N/A"}\nContext: ${JSON.stringify(context)}`;

                    const requestPayload = {
                        model_id: process.env.SBG_CHAT_MODEL || "openai.gpt-oss-120b-1:0",
                        messages: [
                            {
                                role: "user",
                                content: content
                            }
                        ],
                        system_prompt: systemPrompt,
                        max_tokens: 700
                    };

                    const response = await fetch("http://apiaccess.iti.net.eg/api/v1/student/chat", {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${apiKey}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify(requestPayload)
                    });

                    if (!response.ok) {
                        console.log(response);
                        throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
                    }
                    // console.log(response);

                    const data: any = await response.json();
                    // console.log(data);
                    
                    const generatedText = [
                        data.output_text,
                        data.reply,
                        data.content,
                        data.choices?.[0]?.message?.content,
                        data.choices?.[0]?.text,
                        typeof data.message === 'string' ? data.message : data.message?.content,
                    ].find((value): value is string => typeof value === 'string' && value.trim().length > 0);

                    const finalText = generatedText || this.createFallbackDescription(description, context);
                    if (!generatedText) {
                        this.logger.warn(`SBG returned no completed text (status=${String(data.status ?? "unknown")}); used deterministic fallback.`);
                    }
                    
                    // Split by words to simulate streaming if desired, or just send all at once
                    // We will send it all at once as a single token for simplicity, 
                    // or chunk it into smaller pieces to trigger frontend animation.
                    const chunkSize = 5;
                    for (let i = 0; i < finalText.length; i += chunkSize) {
                        subscriber.next({ data: { type: "token", value: finalText.substring(i, i + chunkSize) } });
                        // Add a small delay to simulate typing
                        await new Promise(r => setTimeout(r, 10));
                    }
                    
                    subscriber.next({ data: { type: "done", id: "complete" } });
                    subscriber.complete();
                } catch (error) {
                    subscriber.error(error);
                }
            })();
        });
    }
}
