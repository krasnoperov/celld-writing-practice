import { mount } from "svelte";
import "./tokens.css";
import "./base.css";
import Page from "./site/Pricing.svelte";

mount(Page, { target: document.getElementById("app") });
