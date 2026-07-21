import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { Observable } from "rxjs";

@Injectable()
export class FormOptimizerService {
    optimizeDescriptionStream(payload: any): Observable<any> {
        return new Observable((subscriber) => {
            (async () => {
                try {
                    const apiKey = process.env.SBG_API_KEY;
                    if (!apiKey) {
                        throw new InternalServerErrorException('SBG_API_KEY is not defined');
                    }
                    
                    const { description, ...context } = payload;
                    
                    const systemPrompt = "You are an expert real estate copywriter. Your task is to optimize and expand the provided property description, making it attractive and professional. Use the provided context details to enrich the description. return only the enhanced string text no any thing other";
                    const content = `Original Description: ${description || "N/A"}\nContext: ${JSON.stringify(context)}`;

                    const requestPayload = {
                        model_id: "openai.gpt-oss-120b-1:0",
                        messages: [
                            {
                                role: "user",
                                content: content
                            }
                        ],
                        system_prompt: systemPrompt,
                        max_tokens: 300
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
                    
                    let generatedText = "";
                    if(data.output_text){
                        generatedText = data.output_text;
                    } else if (data.reply) {
                         generatedText = data.reply;
                    } else if (data.content) {
                         generatedText = data.content;
                    } else if (data.choices && data.choices.length > 0) {
                         generatedText = data.choices[0].message?.content || data.choices[0].text;
                    } else if (data.message) {
                         generatedText = typeof data.message === 'string' ? data.message : data.message.content;
                    } else {
                         generatedText = JSON.stringify(data);
                    }
                    
                    // Split by words to simulate streaming if desired, or just send all at once
                    // We will send it all at once as a single token for simplicity, 
                    // or chunk it into smaller pieces to trigger frontend animation.
                    const chunkSize = 5;
                    for (let i = 0; i < generatedText.length; i += chunkSize) {
                        subscriber.next({ data: { type: "token", value: generatedText.substring(i, i + chunkSize) } });
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