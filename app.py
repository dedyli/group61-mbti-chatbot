import streamlit as st
import requests

# App title and visible header with Tsinghua logo
st.set_page_config(page_title="Group 61 - MBTI Personality Chatbot", layout="centered")
st.markdown("""
    <div style='background-color: #1e293b; padding: 15px; text-align: center; border-bottom: 2px solid violet;'>
        <img src='https://upload.wikimedia.org/wikipedia/en/3/3f/Tsinghua_University_Logo.png' style='height: 60px; vertical-align: middle; margin-right: 15px;' />
        <span style='color: violet; font-size: 26px; font-weight: bold; vertical-align: middle;'>Group 61 – MBTI Personality Chatbot</span>
    </div>
""", unsafe_allow_html=True)

# Initialize chat history
if "messages" not in st.session_state:
    st.session_state["messages"] = []

# Display chat messages
for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])

# User input
prompt = st.chat_input("Say something...")
if prompt:
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    with st.chat_message("assistant"):
        with st.spinner("Thinking..."):
            headers = {
                "Authorization": f"Bearer {st.secrets['OPENROUTER_API_KEY']}",
                "Content-Type": "application/json"
            }

            data = {
                "model": "mistralai/mixtral-8x7b-instruct",
                "messages": st.session_state.messages,
            }

            response = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=headers,
                json=data
            )

            try:
                bot_msg = response.json()["choices"][0]["message"]["content"]
            except Exception as e:
                bot_msg = f"Error: {e}\n\n{response.text}"

            st.markdown(bot_msg)
            st.session_state.messages.append({"role": "assistant", "content": bot_msg})
