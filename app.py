import streamlit as st
import openai

# Replace this with your actual OpenRouter API key
openai.api_key = "YOUR_OPENROUTER_API_KEY"
openai.api_base = "https://openrouter.ai/api/v1"

st.set_page_config(page_title="MBTI Personality Chatbot", layout="centered")

# Tsinghua branding
st.markdown("""
    <div style='text-align: center; padding: 10px;'>
        <img src='https://upload.wikimedia.org/wikipedia/en/3/3f/Tsinghua_University_Logo.png' height='80'/>
        <h1 style='color: white;'>Tsinghua University - IEDE Program</h1>
        <h2 style='color: violet;'>Group 61 - MBTI Personality Chatbot</h2>
    </div>
    <style>
        body {background-color: #0f172a; color: white;}
        .stApp {background-color: #1e293b; padding: 1rem;}
    </style>
""", unsafe_allow_html=True)

st.title("🧠 MBTI Personality Chatbot")
st.markdown("Chat freely with me. After a few responses, I’ll guess your MBTI personality type!")

if "messages" not in st.session_state:
    st.session_state.messages = []
if "mbti_result" not in st.session_state:
    st.session_state.mbti_result = None

user_input = st.chat_input("Say something...")

if user_input:
    st.session_state.messages.append({"role": "user", "content": user_input})

for msg in st.session_state.messages:
    st.chat_message(msg["role"]).write(msg["content"])

# Trigger MBTI prediction after 3+ messages
user_msgs = [m for m in st.session_state.messages if m["role"] == "user"]

if len(user_msgs) >= 3 and not st.session_state.mbti_result:
    convo = "\n".join([f'{m["role"].capitalize()}: {m["content"]}' for m in st.session_state.messages])
    prompt = f"You are a personality expert. Based on the following conversation, what is the user's MBTI personality type?\n\n{convo}\n\nRespond only with the 4-letter MBTI type and a one-line explanation."

    response = openai.ChatCompletion.create(
        model="mistralai/mixtral-8x7b-instruct",
        messages=[{"role": "user", "content": prompt}]
    )

    st.session_state.mbti_result = response["choices"][0]["message"]["content"]

if st.session_state.mbti_result:
    st.markdown(f"🧬 **Predicted MBTI Type:** {st.session_state.mbti_result}")
